import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import date, datetime, timezone
from getpass import getpass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("CIBERCAFE_DATABASE", ROOT / "dados" / "reservas.sqlite3")).resolve()
CONFIG_LOCAL = ROOT / "gerente.local.json"
TAXAS = {"conferencia": 1500, "laboratorio": 2500}
SERVICOS = {
    "Servidor Web": 300,
    "Servidor de Ficheiros": 200,
    "Servidor de Correio": 250,
}
PENDENTE = "Pendente de pagamento presencial"
SESSAO_DURACAO = 8 * 60 * 60
SESSOES = {}
SESSOES_LOCK = threading.Lock()


@contextmanager
def abrir_base():
    ligacao = sqlite3.connect(DATABASE, timeout=10)
    ligacao.row_factory = sqlite3.Row
    ligacao.execute("PRAGMA foreign_keys = ON")
    try:
        yield ligacao
        ligacao.commit()
    except Exception:
        ligacao.rollback()
        raise
    finally:
        ligacao.close()


def preparar_base():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    with abrir_base() as ligacao:
        ligacao.execute("PRAGMA journal_mode = WAL")
        ligacao.execute(
            """
            CREATE TABLE IF NOT EXISTS reservas (
                codigo TEXT PRIMARY KEY,
                bi TEXT NOT NULL,
                entidade TEXT NOT NULL,
                tipo TEXT NOT NULL CHECK (tipo IN ('conferencia', 'laboratorio')),
                data TEXT NOT NULL,
                hora TEXT NOT NULL,
                horas INTEGER NOT NULL CHECK (horas BETWEEN 1 AND 8),
                servicos TEXT NOT NULL DEFAULT '[]',
                preco REAL NOT NULL CHECK (preco >= 0),
                estado TEXT NOT NULL CHECK (
                    estado IN ('Pendente de pagamento presencial', 'Pago')
                ),
                criado_em TEXT NOT NULL,
                pago_em TEXT
            )
            """
        )
        ligacao.execute(
            "CREATE INDEX IF NOT EXISTS idx_reservas_data ON reservas(data, hora)"
        )


def validar_reserva(dados, legado=False):
    if not isinstance(dados, dict):
        raise ValueError("Os dados da reserva são inválidos.")

    bi = dados.get("bi")
    entidade = dados.get("entidade")
    tipo = dados.get("tipo")
    data_reserva = dados.get("data")
    hora = dados.get("hora")
    horas = dados.get("horas")
    servicos = dados.get("servicos", [])

    if not isinstance(bi, str) or not bi.strip() or len(bi.strip()) > 80:
        raise ValueError("Indique um número de BI válido (máximo 80 caracteres).")
    if not isinstance(entidade, str) or not entidade.strip() or len(entidade.strip()) > 160:
        raise ValueError("Indique uma entidade válida (máximo 160 caracteres).")
    if not isinstance(tipo, str) or tipo not in TAXAS:
        raise ValueError("O tipo de sala indicado não é válido.")
    if not isinstance(data_reserva, str):
        raise ValueError("Indique uma data válida.")
    try:
        data_validada = date.fromisoformat(data_reserva)
    except ValueError as erro:
        raise ValueError("A data deve estar no formato AAAA-MM-DD.") from erro
    if not legado and data_validada < date.today():
        raise ValueError("Não é possível reservar uma data passada.")
    if not isinstance(hora, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", hora):
        raise ValueError("Indique uma hora válida.")
    if not isinstance(horas, int) or isinstance(horas, bool) or not 1 <= horas <= 8:
        raise ValueError("A duração deve estar entre 1 e 8 horas.")
    hora_inicio, minuto_inicio = map(int, hora.split(":"))
    if hora_inicio + minuto_inicio / 60 < 7.5 or hora_inicio + minuto_inicio / 60 + horas > 21:
        raise ValueError("A reserva deve decorrer entre as 07:30 e as 21:00.")
    if not isinstance(servicos, list):
        raise ValueError("A lista de serviços de servidor é inválida.")
    if tipo != "laboratorio" and servicos:
        raise ValueError("Os serviços de servidor só podem ser reservados no laboratório.")
    if any(not isinstance(servico, str) or servico not in SERVICOS for servico in servicos):
        raise ValueError("Um ou mais serviços de servidor não são válidos.")
    if len(set(servicos)) != len(servicos):
        raise ValueError("Um ou mais serviços de servidor não são válidos.")

    codigo = None
    if legado:
        codigo = str(dados.get("codigo", "")).strip()
        if not re.fullmatch(r"[A-Za-z0-9-]{1,40}", codigo):
            raise ValueError("Uma reserva antiga tem um código inválido.")

    total_hora = TAXAS[tipo] + sum(SERVICOS[nome] for nome in servicos)
    estado = "Pago" if legado and dados.get("estado") == "Pago" else PENDENTE
    pago_em = dados.get("pago_em") if estado == "Pago" else None
    return {
        "codigo": codigo,
        "bi": bi.strip(),
        "entidade": entidade.strip(),
        "tipo": tipo,
        "data": data_validada.isoformat(),
        "hora": hora,
        "horas": horas,
        "servicos": servicos,
        "preco": horas * total_hora,
        "estado": estado,
        "pago_em": pago_em,
    }


def reserva_publica(linha):
    item = dict(linha)
    item["servicos"] = json.loads(item["servicos"])
    return item


class PedidoHandler(SimpleHTTPRequestHandler):
    admin_password = ""

    def log_message(self, formato, *argumentos):
        print(f"{self.address_string()} - {formato % argumentos}")

    def enviar_json(self, estado, dados):
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(estado)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    def ler_json(self):
        try:
            tamanho = int(self.headers.get("Content-Length", "0"))
        except ValueError as erro:
            raise ValueError("Tamanho do pedido inválido.") from erro
        if tamanho < 1 or tamanho > 2 * 1024 * 1024:
            raise ValueError("O pedido deve conter JSON até 2 MB.")
        try:
            return json.loads(self.rfile.read(tamanho))
        except (json.JSONDecodeError, UnicodeDecodeError) as erro:
            raise ValueError("O corpo do pedido não contém JSON válido.") from erro

    def token_gerente(self):
        esquema, _, token = self.headers.get("Authorization", "").partition(" ")
        if esquema.lower() != "bearer" or not token:
            return False
        agora = time.monotonic()
        with SESSOES_LOCK:
            expiradas = [chave for chave, validade in SESSOES.items() if validade <= agora]
            for chave in expiradas:
                del SESSOES[chave]
            return token in SESSOES

    def terminar_sessao(self):
        esquema, _, token = self.headers.get("Authorization", "").partition(" ")
        if esquema.lower() == "bearer" and token:
            with SESSOES_LOCK:
                SESSOES.pop(token, None)

    def exigir_gerente(self):
        if not self.token_gerente():
            self.enviar_json(401, {"erro": "Sessão do gerente inválida ou expirada. Entre novamente."})
            return False
        return True

    def do_GET(self):
        caminho = unquote(urlsplit(self.path).path)
        if caminho == "/api/saude":
            self.enviar_json(200, {"ok": True})
            return
        if caminho == "/api/sessao":
            if not self.exigir_gerente():
                return
            self.enviar_json(200, {"autenticada": True})
            return
        if caminho == "/api/reservas":
            if not self.exigir_gerente():
                return
            try:
                with abrir_base() as ligacao:
                    linhas = ligacao.execute(
                        "SELECT * FROM reservas ORDER BY criado_em DESC, codigo DESC"
                    ).fetchall()
                self.enviar_json(200, {"reservas": [reserva_publica(linha) for linha in linhas]})
            except sqlite3.Error:
                self.enviar_json(500, {"erro": "Não foi possível consultar a base de dados SQLite."})
            return
        if caminho.startswith("/api/"):
            self.enviar_json(404, {"erro": "Endpoint não encontrado."})
            return
        super().do_GET()

    def do_POST(self):
        caminho = unquote(urlsplit(self.path).path)
        try:
            dados = self.ler_json()
        except ValueError as erro:
            self.enviar_json(400, {"erro": str(erro)})
            return

        if caminho == "/api/login":
            senha = dados.get("senha") if isinstance(dados, dict) else None
            if not isinstance(senha, str) or not hmac.compare_digest(senha, self.admin_password):
                self.enviar_json(401, {"erro": "Senha do gerente incorrecta."})
                return
            token = secrets.token_urlsafe(32)
            with SESSOES_LOCK:
                SESSOES[token] = time.monotonic() + SESSAO_DURACAO
            self.enviar_json(200, {"token": token, "expira_em_segundos": SESSAO_DURACAO})
            return

        if caminho == "/api/logout":
            self.terminar_sessao()
            self.enviar_json(200, {"ok": True})
            return

        if caminho == "/api/reservas":
            try:
                reserva = validar_reserva(dados)
                reserva["codigo"] = f"CC-{secrets.token_hex(4).upper()}"
                reserva["criado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                with abrir_base() as ligacao:
                    ligacao.execute(
                        """
                        INSERT INTO reservas
                        (codigo, bi, entidade, tipo, data, hora, horas, servicos, preco, estado, criado_em, pago_em)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            reserva["codigo"], reserva["bi"], reserva["entidade"], reserva["tipo"],
                            reserva["data"], reserva["hora"], reserva["horas"],
                            json.dumps(reserva["servicos"], ensure_ascii=False), reserva["preco"],
                            reserva["estado"], reserva["criado_em"], None,
                        ),
                    )
                self.enviar_json(201, {"reserva": reserva})
            except ValueError as erro:
                self.enviar_json(400, {"erro": str(erro)})
            except sqlite3.Error:
                self.enviar_json(500, {"erro": "Não foi possível guardar a reserva na base de dados SQLite."})
            return

        if caminho == "/api/reservas/migrar":
            if not self.exigir_gerente():
                return
            lista = dados.get("reservas") if isinstance(dados, dict) else None
            if not isinstance(lista, list) or len(lista) > 1000:
                self.enviar_json(400, {"erro": "A lista de reservas antigas é inválida ou excede 1000 itens."})
                return
            try:
                importadas = 0
                with abrir_base() as ligacao:
                    for item in lista:
                        reserva = validar_reserva(item, legado=True)
                        reserva["criado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                        cursor = ligacao.execute(
                            """
                            INSERT OR IGNORE INTO reservas
                            (codigo, bi, entidade, tipo, data, hora, horas, servicos, preco, estado, criado_em, pago_em)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                reserva["codigo"], reserva["bi"], reserva["entidade"], reserva["tipo"],
                                reserva["data"], reserva["hora"], reserva["horas"],
                                json.dumps(reserva["servicos"], ensure_ascii=False), reserva["preco"],
                                reserva["estado"], reserva["criado_em"], reserva["pago_em"],
                            ),
                        )
                        importadas += cursor.rowcount
                self.enviar_json(200, {"importadas": importadas})
            except ValueError as erro:
                self.enviar_json(400, {"erro": str(erro)})
            except sqlite3.Error:
                self.enviar_json(500, {"erro": "Não foi possível migrar as reservas para SQLite."})
            return

        self.enviar_json(404, {"erro": "Endpoint não encontrado."})

    def do_PATCH(self):
        caminho = unquote(urlsplit(self.path).path)
        correspondencia = re.fullmatch(r"/api/reservas/([A-Za-z0-9-]+)/pagamento", caminho)
        if not correspondencia:
            self.enviar_json(404, {"erro": "Endpoint não encontrado."})
            return
        if not self.exigir_gerente():
            return

        codigo = correspondencia.group(1)
        try:
            with abrir_base() as ligacao:
                cursor = ligacao.execute(
                    """
                    UPDATE reservas
                    SET estado = 'Pago', pago_em = ?
                    WHERE codigo = ? AND estado = ?
                    """,
                    (datetime.now(timezone.utc).isoformat(timespec="seconds"), codigo, PENDENTE),
                )
                if cursor.rowcount == 0:
                    existe = ligacao.execute(
                        "SELECT estado FROM reservas WHERE codigo = ?", (codigo,)
                    ).fetchone()
                    if existe is None:
                        self.enviar_json(404, {"erro": "Reserva não encontrada."})
                    else:
                        self.enviar_json(409, {"erro": "Esta reserva já está marcada como paga."})
                    return
                linha = ligacao.execute(
                    "SELECT * FROM reservas WHERE codigo = ?", (codigo,)
                ).fetchone()
            self.enviar_json(200, {"reserva": reserva_publica(linha)})
        except sqlite3.Error:
            self.enviar_json(500, {"erro": "Não foi possível actualizar o pagamento na base de dados SQLite."})

    def send_head(self):
        destino = Path(self.translate_path(self.path)).resolve()
        try:
            destino.relative_to(ROOT)
        except ValueError:
            self.send_error(404, "Ficheiro não encontrado.")
            return None
        nome = destino.name.lower()
        if any(nome.endswith(sufixo) for sufixo in (".sqlite", ".sqlite3", ".db", "-wal", "-shm")):
            self.send_error(404, "Ficheiro não encontrado.")
            return None
        return super().send_head()


def obter_senha():
    senha = os.environ.get("CIBERCAFE_ADMIN_PASSWORD")
    if senha is None and CONFIG_LOCAL.exists():
        try:
            configuracao = json.loads(CONFIG_LOCAL.read_text(encoding="utf-8"))
            senha = configuracao.get("senha_gerente") if isinstance(configuracao, dict) else None
        except (OSError, json.JSONDecodeError) as erro:
            raise SystemExit(f"Não foi possível ler {CONFIG_LOCAL.name}: {erro}") from erro
    if senha is None:
        while True:
            senha = getpass("Defina a senha do gerente (mínimo 12 caracteres): ")
            if len(senha) >= 12:
                return senha
            print("A senha deve ter pelo menos 12 caracteres.")
    if len(senha) < 12:
        raise SystemExit("CIBERCAFE_ADMIN_PASSWORD deve ter pelo menos 12 caracteres.")
    return senha


def main():
    preparar_base()
    PedidoHandler.admin_password = obter_senha()
    host = os.environ.get("CIBERCAFE_HOST", "127.0.0.1")
    porta = int(os.environ.get("CIBERCAFE_PORT", "8000"))
    servidor = ThreadingHTTPServer((host, porta), PedidoHandler)
    print(f"Cibercafé disponível em http://{host}:{porta}")
    print(f"Base de dados SQLite: {DATABASE}")
    print("Mantenha esta janela aberta enquanto utilizar o sistema. Ctrl+C termina o servidor.")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor terminado.")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
