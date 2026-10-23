# Agenda institucional em PDF

A administração pode baixar a agenda em PDF para o período semanal, anual ou personalizado, com os filtros de curso/coordenação e tema aplicados. O arquivo usa os eventos **aprovados**; não inclui rascunhos, pedidos pendentes, justificativas ou observações internas.

O modelo usa papel A4 em paisagem, fundo branco, cabeçalho verde `#00562B`, a identificação **Univille campus São Bento do Sul**, o período selecionado, a logo oficial e a numeração das páginas. A tabela mantém as oito colunas do modelo institucional: Evento, Tema, Data, Horário, Local, Público alvo, Palestrante/Ministrante e Realização. O público inclui o curso e os semestres informados.

Os eventos são ordenados por data, horário de início e nome. As linhas comuns permanecem juntas. Quando um campo ultrapassa a altura útil de uma página, o conteúdo continua na seguinte, identificado por **(continuação)**. O tamanho da fonte do corpo permanece em 9,5 pontos, sem reduzir textos longos nem cortar campos. Todas as páginas repetem o cabeçalho da tabela, o período e a logo; um período vazio produz uma página com a mensagem de ausência de eventos aprovados.

O texto é selecionável, e as fontes Noto Sans Regular e Bold são incorporadas para preservar os acentos e a aparência em outros computadores. Os arquivos e a licença SIL Open Font License 1.1 estão em `public/fonts/`, copiados para `dist/fonts/` no build. A logo vem de `public/branding/`, também copiada para `dist/branding/`.

## Implementação

`generateAgendaPdf(events, { from, to, period })`, em `server/pdf.js`, retorna uma promessa de `Buffer`. A função recebe os eventos já autorizados e filtrados pela rota administrativa; não acessa o banco nem realiza chamadas de rede. PDFKit é usado diretamente no servidor, sem depender de Microsoft Office, LibreOffice ou conversão de PowerPoint no ambiente de produção.

A rota `GET /api/admin/agenda.pdf` exige sessão administrativa e recebe os mesmos parâmetros de período, curso/coordenação e tema da exportação PowerPoint. O download usa o tipo `application/pdf` e extensão `.pdf`, adequado para abrir em navegadores e leitores de PDF.

## Verificação

Os testes verificam a estrutura do PDF, a orientação, as oito colunas, os acentos, a ordenação, as fontes e a logo incorporadas, o estado vazio e a preservação de textos longos através de várias páginas. A verificação visual usa Poppler para renderizar os exemplos normal, vazio e anual; a extração de texto confirma os caracteres e os marcadores finais dos campos longos. Essas ferramentas de revisão não são requisitos do serviço de produção.
