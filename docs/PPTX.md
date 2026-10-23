# Agenda institucional em PowerPoint

Na administração, abra **Relatórios**, escolha **Semanal**, **Anual** ou **Personalizado**, ajuste os filtros e pressione **Aplicar filtros**. A semana vai de segunda a domingo. A semana inicial usa a data de São Paulo, sem depender do fuso do computador. O relatório anual permite selecionar o ano.

- **Excel / CSV** exporta os registros e o status selecionados na tabela administrativa.
- **PowerPoint · aprovados** exporta somente eventos aprovados, usando o período, o setor/curso e o tema aplicados. O status selecionado para o CSV não muda essa regra.
- Em um período vazio, o PowerPoint mantém o modelo e informa a ausência de eventos aprovados.

## Estrutura e campos

A apresentação utiliza slides em paisagem, fundo branco, faixa verde com o título institucional em duas linhas, tabela com bordas finas e marca oficial centralizada no rodapé. A estrutura foi reconstruída a partir da fotografia fornecida. Sem o PPTX original, não é possível afirmar identidade exata de fonte, medidas e cor da fotografia.

A tabela possui oito colunas editáveis no próprio PowerPoint:

| Coluna                  | Origem                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| Evento                  | Nome do evento                                                    |
| Tema                    | Tema cadastrado                                                   |
| Data                    | Data do evento em dd/mm/aaaa                                      |
| Horário                 | Horário inicial                                                   |
| Local                   | Ambiente cadastrado                                               |
| Público alvo            | Público em texto, curso e semestre do público, quando preenchidos |
| Palestrante/Ministrante | Palestrante informado                                             |
| Realização              | Campo explícito de entidade organizadora                          |

**Realização** não é inferida do solicitante, autor, centro de custo ou curso. Quando o campo não está preenchido, a apresentação utiliza “—”. O arquivo preserva a ordem por data e horário. Semanas com muitos eventos geram mais slides, com o título e o cabeçalho repetidos. Um campo muito extenso continua no slide seguinte, com indicação de continuação, sem remover texto nem diminuir a fonte.

O título é “Agenda semanal de eventos” para semanas, “Agenda anual de eventos” para anos e “Agenda de eventos” para intervalos personalizados. A segunda linha identifica **Univille campus São Bento do Sul**.

## Implementação e publicação

`server/presentation.js` expõe `generateAgendaPptx(events, { from, to, period })`, que retorna uma Promise de Buffer. A rota administrativa valida o acesso, as datas e o período e seleciona exclusivamente eventos aprovados antes da geração. O arquivo usa tabelas, textos e formas nativos OOXML, não capturas da página.

A geração utiliza a dependência de produção [PptxGenJS](https://gitbrent.github.io/PptxGenJS/docs/api-tables/), sem exigir PowerPoint ou LibreOffice no servidor. A marca é carregada de `dist/branding/univille-logo.png` nos pacotes publicados e de `public/branding/univille-logo.png` durante o desenvolvimento. Sua [origem institucional](https://www.univille.edu.br/) está documentada em `public/branding/SOURCE.md`; o PNG original foi preservado.

## Verificação

Os testes em `tests/presentation.test.js` verificam o ZIP do PPTX, a tabela editável de oito colunas, a presença da imagem oficial, as datas, o escape de caracteres XML, a ordenação, o estado vazio, a paginação e a preservação de campos longos dentro do espaço reservado à tabela.

Na revisão de 23/10/2026 foram geradas apresentações de teste com seis eventos, período vazio e evento com campo longo em relatório anual. Todos os slides foram renderizados com LibreOffice e inspecionados visualmente para conferir legibilidade, cabeçalho, limites da tabela, rodapé e continuação. Os dados de teste ficaram em `work/`, fora do repositório e da base publicada.
