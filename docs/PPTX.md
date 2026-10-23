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

## Compatibilidade com PowerPoint

Uma falha de abertura no PowerPoint levou à revisão do XML interno, além da renderização visual. A reprodução local do gerador anterior produzia um ZIP íntegro e XML bem formado, mas continha três violações das regras OOXML:

- Células da tabela usavam `anchor="mid"`; o valor correto para centralização vertical é `ctr`. A opção de tabela passou a usar `valign: "middle"`, que a biblioteca converte corretamente.
- Tabelas e outros objetos recebiam identificadores de desenho `p:cNvPr/@id` repetidos. A geração agora atribui identificadores únicos dentro de cada slide. As agendas não contêm animações ou conectores que referenciem esses identificadores; os relacionamentos `r:id`, a imagem e as tabelas editáveis são preservados.
- `ppt/presentation.xml` posicionava `notesMasterIdLst` depois de `sldIdLst`. A ordem foi corrigida para seguir a sequência exigida por `CT_Presentation`, mantendo os identificadores dos relacionamentos.

A restrição do atributo `anchor` consta na [documentação da Microsoft](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.tablecellproperties.anchor?view=openxml-3.0.1). A colisão de identificadores é um [problema registrado no PptxGenJS 4.0.1](https://github.com/gitbrent/PptxGenJS/issues/1532). A normalização utiliza JSZip diretamente, sem substituir o PptxGenJS ou alterar o modelo institucional.

A verificação utilizou os esquemas normativos [ECMA-376, Parte 4](https://ecma-international.org/publications-and-standards/standards/ecma-376/), extraídos do arquivo oficial de esquemas de transição. Na reprodução anterior, os atributos de célula e a ordem da apresentação falhavam na validação. Após a correção, os arquivos PresentationML e DrawingML dos casos com um slide e seis slides passaram na validação XSD, além da verificação separada de unicidade dos identificadores de desenho. O arquivo corrigido também foi reaberto, renderizado com LibreOffice e inspecionado visualmente.

Os testes permanentes verificam essas regras em apresentações vazias, preenchidas e paginadas. Um teste HTTP autentica uma conta fictícia, baixa o PPTX como bytes, confere MIME, nome, tamanho, integridade CRC do ZIP e compara cada parte descompactada com a geração direta, normalizando apenas os horários de criação/metadados. O transporte do download não apresentou corrupção ou conversão para texto; a correção concentra-se no conteúdo OOXML.

Não havia PowerPoint nativo disponível no ambiente de verificação. A validação normativa e a abertura no LibreOffice são evidências técnicas da correção, mas não equivalem a uma abertura confirmada na versão do PowerPoint para Windows do usuário.
