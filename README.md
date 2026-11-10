# CIBERCAFÉ – 8º Grupo PRWE PL
Universidade Zambeze · Programação Web · Docente: MSc. Eng.º Félix Macueia

## Como executar
1. Instale o Python 3.10 ou superior, se ainda não estiver instalado.
2. No Windows, execute `iniciar_servidor.bat` ou, no terminal aberto na pasta do projecto, execute `python servidor.py`.
3. Defina uma senha do gerente com pelo menos 12 caracteres quando o servidor solicitar.
4. Abra `http://127.0.0.1:8000` no navegador. Mantenha a janela do servidor aberta enquanto utiliza o sistema.

Se existir, o servidor lê a senha do ficheiro local `gerente.local.json` (campo `senha_gerente`). Esse ficheiro contém a senha em texto simples: não o partilhe. Está excluído pelo `.gitignore`; a variável de ambiente `CIBERCAFE_ADMIN_PASSWORD` tem prioridade se estiver configurada.

O SQLite cria automaticamente `dados/reservas.sqlite3`. A página inicial não mostra a gestão: use o link "Área de Gestão" para abrir `gestao.html` e iniciar sessão. No painel único da área de gestão, o gerente pode gerir reservas/pagamentos, registar usuários, acompanhar máquinas e fila de espera, executar operações sobre usuários, registar serviços e consultar relatórios e estatísticas. Termine a sessão com "Terminar sessão" ou feche o navegador. As sessões expiram após oito horas.

Na primeira entrada, reservas existentes no `localStorage` deste mesmo endereço do servidor são transferidas para SQLite e removidas do armazenamento antigo apenas depois da migração concluir. Se os dados antigos foram guardados ao abrir `index.html` directamente como `file://`, abra esse ficheiro no mesmo navegador, exporte as reservas antigas em JSON e importe o ficheiro na sessão do gerente no servidor. Faça cópias de segurança de `dados/reservas.sqlite3`.

Por padrão, o servidor aceita ligações apenas neste computador (`127.0.0.1`). A aplicação não deve ser exposta a outros computadores ou à Internet sem configurar uma hospedagem segura com HTTPS e protecção de rede adequada.

Coloque o logo oficial em `img/uzlogo.png`.

Na área de gestão, descarregue o relatório Excel `.xlsx` ou abra a versão de impressão e escolha "Guardar como PDF". Os relatórios incluem os contactos, o horário, as taxas das salas e os detalhes, estados e totais das reservas.

## Estrutura
- index.html ........... Site: informação, serviços, salas, reserva
- gestao.html .......... Gestão reservada: reservas, usuários, máquinas, serviços e relatórios
- css/estilo.css ....... Estilos (partilhados)
- js/site/reservas.js .. Lógica das reservas
- servidor.py .......... Servidor HTTP e API com SQLite
- dados/reservas.sqlite3 Base de dados local (criada automaticamente)
- js/sistema/modelos.js  Classes: usuários e serviços (regras de preço)
- js/sistema/gestor.js . Máquinas, fila e estatísticas
- js/sistema/painel.js . Interface do sistema
- dados/menu.js ........ Menu da cafetaria (ficheiro externo)
