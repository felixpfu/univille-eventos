# Relatório para Excel em português do Brasil

A exportação administrativa gera um CSV com **ponto e vírgula (`;`) entre as colunas**, UTF-8 com BOM e finais de registro CRLF. Isso corrige o arquivo separado por vírgulas que o Excel com separador de lista brasileiro abria inteiro na coluna A. O arquivo mantém as quinze colunas e os registros selecionados pelos filtros do relatório.

O Excel interpreta arquivos CSV de acordo com suas configurações regionais. O BOM permite reconhecer a codificação UTF-8 na abertura e preservar nomes como “Realização”, “Início” e “João”. Referências: [importação e separadores no Excel](https://support.microsoft.com/en-us/excel/get-started/import-or-export-text-txt-or-csv-files) e [abertura de CSV UTF-8 com BOM](https://support.microsoft.com/en-gb/excel/opening-csv-utf-8-files-correctly-in-excel).

## Formato do arquivo

- BOM UTF-8: bytes `EF BB BF`.
- Primeira linha: o cabeçalho real, começando por `Evento;Data;Início;Fim` (cada célula é delimitada por aspas).
- Separador de campos: `;`. Separador entre registros: `\r\n`, incluindo o último registro.
- Todas as células entre aspas duplas; aspas internas duplicadas. Ponto e vírgula, vírgula e quebras de linha dentro de uma célula continuam pertencendo àquela célula.
- Conteúdo que possa iniciar uma fórmula de planilha recebe um apóstrofo antes do valor. A proteção de `=`, `+`, `-`, `@`, tabulação e retorno de carro, inclusive após espaços, foi mantida.
- Resultado vazio: cabeçalho com quinze colunas e nenhuma linha de eventos.

A diretiva específica de Excel `sep=;` **não é inserida**. Embora possa indicar o separador a determinadas versões do Excel, ela adicionaria um registro fora da tabela: um leitor CSV comum com delimitador `;` a interpretaria como duas células antes do cabeçalho. Preservar o cabeçalho como primeira linha facilita a leitura por outros programas e mantém a quantidade de colunas consistente. O arquivo é um CSV no dialeto com ponto e vírgula; não promete autodetecção universal em todas as configurações regionais.

No Excel com separador regional diferente, use **Dados → De Texto/CSV**, selecione UTF-8 e o delimitador **ponto e vírgula** na prévia de importação. Não é necessário alterar as configurações regionais do computador. Outros leitores devem usar delimitador `;` e tratar o BOM UTF-8; em Python, por exemplo, `encoding="utf-8-sig"` e `delimiter=";"`.

## Verificação

Os testes de CSV em `tests/backend.test.js` usam o parser independente [`csv-parse`](https://csv.js.org/parse/api/sync/), uma dependência de desenvolvimento executada no próprio Node.js. Ele lê o BOM, exige delimitador `;` e registros com quantidade de colunas consistente; não há necessidade de Python ou Excel para executar a suíte de testes.

São verificados os bytes do BOM na resposta HTTP, cabeçalho, quinze colunas em todos os registros, separadores, aspas, acentos, quebras de linha internas, proteção de fórmulas, resposta vazia e a combinação de período, setor/curso, tema e estado. A leitura por parser valida o formato; a abertura no aplicativo Excel deve ser conferida no ambiente do responsável antes de declarar verificação visual nesse aplicativo.
