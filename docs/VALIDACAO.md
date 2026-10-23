# Validação

Registro da revisão de **23/10/2026**. Os testes usam dados fictícios e bancos temporários; não dependem de contas ou eventos da produção. Requisitos e limites estão em [REQUISITOS.md](REQUISITOS.md).

## Verificações automatizadas

Após `npm ci`, execute na raiz do projeto:

```bash
npm test
npm run build
npm audit --omit=dev
```

A revisão funcional da v1.3.1 registrou **30 testes aprovados**: 18 de backend, sete de notificações, três de PowerPoint e dois de regressão das listagens. A auditoria de produção, repetida após fixar `image-size` em `2.0.4` via override, informou **zero vulnerabilidades conhecidas** nessa execução. Essa conclusão se refere às dependências e à base de avisos consultada; deve ser reavaliada a cada atualização.

Na v1.4.1, a suíte inclui também cinco testes do operador de conteúdo para apresentação, totalizando **35 testes**. Eles usam HTTP e SQLite temporários para conferir preservação dos oito eventos e de um evento de solicitante com cadastros compartilhados; ausência de alterações em repetição; recusa de edições manuais e colisões antes da primeira escrita; prévia sem rede; e retomada de atualização interrompida.

Na v1.5.0, a suíte passa a **43 testes**. Duas regressões CSV usam `csv-parse` para conferir os quinze campos, BOM, acentos, delimitador brasileiro, conteúdo entre aspas, fórmulas e filtros. Duas regressões PPTX conferem regras OOXML e o download binário por HTTP. Três testes PDF usam o parser real Mozilla PDF.js para ler conteúdo, dimensões, imagem, fontes, paginação e campos extensos. A integração HTTP do PDF verifica acesso anônimo e por três perfis, datas inválidas, combinação de filtros, exclusão de pendentes e resultado vazio.

A revisão **v1.6.0** contém **54 testes**: acrescenta nove casos do helper de navegação mensal e dois casos HTTP da janela pública aos 43 anteriores. O helper verifica grupos negativos, virada de ano, fevereiro em anos bissextos e comuns, limites de janeiro de 1900/dezembro de 9999, argumentos inválidos e resultados iguais em três fusos horários. Os casos HTTP conferem o parâmetro `month`, consultas históricas e futuras, limites e formatos inválidos e a preservação dos filtros de aprovação e privacidade. A execução integral, o build, a auditoria e o CI devem ser conferidos a cada publicação.

A revisão **v1.7.0** contém **60 testes**, acrescentando seis casos de espaços aos 54 anteriores. A execução local integral registrou **60 aprovados**, o build foi aprovado e `npm audit --omit=dev` informou **zero vulnerabilidades conhecidas** nessa execução. Os casos cobrem base vazia, migração v4 → v5 com dados e versões preservados, reaplicação idempotente, metadados públicos, permissões, edição com campos omitidos e limpeza explícita, limites e tipos de capacidade e recusa de chaves de imagem externas ou desconhecidas. CI e publicação dessa versão devem ter seus resultados registrados depois de concluídos; o aceite local de navegador está descrito abaixo.

| Grupo                      | Evidências                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Autenticação e permissões  | Hash de senha, sessões, origem/CSRF, cookies de produção, propriedade de pedidos, desativação e expiração.                                                                                 |
| Fluxo de pedidos           | Rascunho incompleto, envio, rejeição motivada, correção/reenvio, aprovação, cancelamento e exclusão restrita.                                                                              |
| Agenda e concorrência      | Datas/horários e recursos inválidos, conflitos, horários adjacentes, ambientes distintos e aprovação concorrente.                                                                          |
| Fila de prioridade         | Rascunho antigo não ganha prioridade; envio decide, inclusive no mesmo milissegundo. Correções preservam posição; mudanças de reserva e reenvio a reiniciam.                               |
| Campos e relatórios        | Realização obrigatória no envio, curso/semestre do público, filtros de estado, proteção do PPTX e exportação apenas de aprovados.                                                          |
| Migração v1 → v2           | Preservação de contas/eventos/auditoria, reconstrução pelo envio mais recente, fallback histórico documentado e reaplicação idempotente.                                                   |
| Persistência e CLI         | Base inicial vazia, reinicialização sem perda, integridade referencial e provisionamento através do symlink de release usado na produção.                                                  |
| Notificações               | Sem inscrição automática; destinatário da própria conta; indisponibilidade explícita sem SMTP; confirmação, expiração, uso único e descadastro.                                            |
| Processamento de e-mail    | Preferências e setor, retirada de consentimento antes do envio, versões/cancelamentos, fuso de São Paulo, deduplicação, retentativas e erros sem dados sensíveis.                          |
| Listagens                  | Volume e conteúdo da listagem permanecem corretos; eventos e recursos são carregados em duas consultas, sem uma consulta adicional por evento.                                             |
| Conteúdo para apresentação | Alterações limitadas ao plano; IDs, reservas, fila, vínculos e dados de outros eventos preservados; catálogos externos reutilizados sem sobrescrita; repetição e retomada sem duplicações. |
| Arquivo PowerPoint         | ZIP/OOXML válido, oito colunas editáveis, logo oficial, ordenação, datas, escape XML, período vazio, paginação e preservação de textos longos.                                             |

As integrações do backend utilizam servidor HTTP e SQLite reais. Somente o transporte SMTP é simulado: **nenhum teste envia e-mail**. Os testes de PPTX inspecionam o arquivo produzido. O CI instala pelo lockfile, testa e compila com Node 24; não publica e não contém credenciais de produção.

A revisão externa do PPTX utilizou os esquemas oficiais ECMA-376 Parte 4: os 30 componentes PresentationML/DrawingML de duas apresentações corrigidas passaram, além da checagem de IDs de desenho únicos por slide. Houve abertura e renderização no LibreOffice. Os PDFs normal, vazio e anual foram renderizados com Poppler, inspecionados visualmente e lidos com pypdf; campos extensos foram preservados até seus marcadores finais. Esses programas são ferramentas de QA, sem dependência no servidor. Não havia Microsoft PowerPoint ou Excel nativos disponíveis; a abertura nesses aplicativos do usuário não foi confirmada nesta revisão. Detalhes em [PPTX.md](PPTX.md), [CSV.md](CSV.md) e [PDF.md](PDF.md).

## Interface e documentos

Na **v1.7.2**, **Limpar filtros** remove todos os filtros, incluindo o local pré-selecionado pela página Espaços, preservando mês e visualização. Na revisão local, o Auditório abriu com dois eventos e a limpeza restaurou os cinco eventos do mês. A combinação de busca, setor, tema, local e dia foi removida integralmente. O seletor permitiu trocar o espaço, o cabeçalho acompanhou a seleção e a limpeza também preservou novembro e a visualização Calendário. Em 390 e 320 px não houve rolagem horizontal da página; a limpeza foi repetida em 390 px. O aceite posterior à publicação deve repetir o fluxo e conferir solicitação sem local herdado após limpar.

Na **v1.7.1**, o grupo de ações dos relatórios ocupa a última coluna do grid, alinhando **Semana atual** e **Aplicar filtros** à borda direita dos campos. A revisão local conferiu os períodos semanal e anual, aplicação dos filtros e retorno à semana atual. Em computador e nos temas claro/escuro, as bordas dos botões coincidiram com a borda direita do formulário. Em 980, 390 e 320 px, o grupo permaneceu à direita, com quebra de linha quando necessária e sem rolagem horizontal da página. A alteração é somente de apresentação, sem migração ou escrita em contas/eventos.

Na v1.5.0, a revisão local conferiu os três botões de exportação lado a lado no computador e empilhados em tela de 390 × 844, sem rolagem horizontal da página. O período anual foi aplicado pela interface e os links passaram a usar suas datas; o botão PDF foi acionado. O teste HTTP lê o documento baixado com parser real, incluindo a mesma combinação de filtros aplicada pela interface.

A revisão no navegador usou janelas de **1440 × 1000** e **390 × 844**, sem rolagem horizontal da página. Foram conferidos calendário inicial, navegação em lista, aplicação de período anual de 1º de janeiro a 31 de dezembro, download semanal de PowerPoint pela interface e salvamento do consentimento com o aviso explícito de SMTP indisponível. As telas utilizam São Bento do Sul, a marca institucional original e tema claro padrão.

Na v1.2.0, foram conferidos os dois fluxos de cadastro, a recusa de CNPJ inválido e sua correção sem duplicar a conta, e a consulta administrativa de empresa/CNPJ. A revisão visual usou 1440 × 1000, 390 × 844 e 320 × 844. Na comparação entre claro/escuro, 52 elementos do cabeçalho/calendário em desktop mantiveram as mesmas medidas e posições; o cabeçalho e os elementos comparados em celular e administração também permaneceram alinhados. Não houve rolagem horizontal da página nos cenários conferidos. A tipografia usa corpo e campos de 16 px ou mais, controles de 14–16 px e auxiliares de no mínimo 12 px.

Na v1.3.0, foram conferidos os oito eventos fictícios com manhã/tarde/noite e suas descrições, cursos e vários semestres. A carga via API aprovou oito pedidos; uma segunda execução ignorou os oito sem criar duplicações. A revisão em desktop e celular conferiu lista, calendário e diálogo de detalhes com descrição e participantes. O teste de backend verifica que apenas aprovados são públicos e que objetivo, justificativa, observações e dados de conta não vazam. A migração v4 preserva registros sem preencher descrições a partir de textos internos.

Na v1.3.1, os oito exemplos anteriores foram atualizados via API para Auditório e Miniauditório, mantendo os mesmos IDs, conteúdo, cursos, semestres e horários. Foram criados dois locais sem presumir recursos ou capacidade; os catálogos antigos permaneceram intactos. A segunda execução do atualizador e a repetição do seed ignoraram os oito registros, sem novas versões ou duplicações. O filtro público e o cadastro priorizam as duas opções sob o rótulo “Local do evento”. A ordem das opções foi conferida no navegador.

Na v1.4.1, os oito exemplos receberam textos de apresentação em linguagem institucional. A prévia local no navegador conferiu títulos e temas sem rótulos de demonstração, cursos e semestres na lista, além de descrição completa, equipe ministrante e realização nos detalhes. Datas, horários, locais e a separação calendário/lista permaneceram iguais. A origem dos exemplos continua documentada internamente em [APRESENTACAO.md](APRESENTACAO.md), sem alegação de programação oficial verificada. Por escolha expressa do responsável, o evento criado por ele não integra o plano de edição.

O roteiro deve ser repetido após mudanças visuais ou de fluxo. Essas verificações pontuais não constituem uma suíte permanente de navegador nem uma avaliação completa em todos os dispositivos.

A apresentação foi reconstruída a partir da fotografia. Na revisão de 23/10/2026, apresentações fictícias com seis eventos, período vazio e campo longo foram renderizadas com LibreOffice e todos os slides foram inspecionados. Foram conferidos cabeçalho, tabela, rodapé, legibilidade e continuação. Isso não prova identidade exata com o PPTX original, que não foi fornecido. Detalhes em [PPTX.md](PPTX.md).

## Publicação e integridade de dados

O pacote de release executa testes e build antes da transferência. O instalador usa dependências de produção pelo lockfile, mantém os dados fora das releases e verifica `/api/health` e a página em localhost. Com `--publish`, também verifica ambos pelo HTTPS e hostname reais. O registro da publicação deve identificar o commit/release efetivamente ativo e o resultado das verificações, sem credenciais.

Antes do snapshot SQLite, o instalador interrompe o serviço web e o worker de e-mail. As migrações v2, v3, v4 e v5 são aditivas; cópia de base de desenvolvimento não integra a publicação. A v5 acrescenta capacidade e chave de imagem aos espaços sem preencher dados ou alterar eventos e versões. O timer SMTP só é habilitado quando a configuração necessária está disponível. Nesta entrega, não há provedor definido e o timer permanece desativado. Procedimentos em [DEPLOYMENT.md](DEPLOYMENT.md).

## Roteiro de aceite

Use dados fictícios e sessões separadas de visitante, solicitante e administrador.

1. Sem login, confira o campus, a marca e a aba **Calendário** inicial com grade, três abas de mês e filtros. Confira as mesmas abas na **Lista**, com cards/resumos apenas do mês selecionado. Alterne a visualização preservando esse mês. Clique em um dia, confirme a lista restrita à data e use **Ver todos do mês** para limpar somente o recorte por dia. Navegue para meses anteriores e posteriores e confirme a ausência de informações internas na agenda pública.
2. Cadastre centro de custo, recurso, ambiente com recurso, setor/curso com centro e tema. Confirme as restrições de exclusão por vínculo.
3. Em Criar conta, confira a escolha inicial de perfil sem campos ou perfil pré-selecionado. Cadastre visitante só com e-mail/senha e solicitante com nome, e-mail, senha, empresa e CNPJ. Confira recusa de CNPJ inválido, persistência dos dados empresariais e sua ausência na agenda pública. Verifique que não há cadastro público de administrador e que os perfis não acessam ações alheias.
4. Salve e reabra rascunho incompleto. Complete **Realização**, curso/semestre do público quando cabíveis, centro automático e respostas Sim/Não.
5. Envie dois pendentes conflitantes. Tente aprovar o segundo primeiro e confira a recusa indicando o protocolo anterior. Rejeite o primeiro, confira o motivo para o autor e teste reenvio com nova posição.
6. Corrija apenas o título de um pendente e confira a posição preservada. Mude local/data/horário e confira a nova posição. Após aprovação, confirme a agenda e os bloqueios de sobreposição.
7. Edite/cancele um aprovado como administrador; cancele um pendente próprio e exclua um rascunho próprio. Confira as confirmações de cancelamento e exclusão, a opção de voltar sem executar e a preservação dos registros enviados.
8. Nos relatórios, informe diretamente Data inicial e Data final ou use as opções Semana atual/Anual para preencher o formulário; pressione Aplicar filtros e combine setor, tema e estado. Compare tabela/CSV e confira as quinze colunas no Excel pt-BR. Abra PowerPoint e PDF e confira as oito colunas, só aprovados, identidade visual e várias páginas quando necessário. CSV segue o estado escolhido; PPTX e PDF usam apenas aprovados.
9. Na conta, salve/desative notificações. Sem SMTP, confira o aviso de indisponibilidade e que não há alegação de envio. A confirmação por link e entrega real devem ser aceitas separadamente, após configurar um provedor e autorizar uma conta de teste.
10. Troque a senha e confirme a revogação de sessões antigas. Confira as confirmações antes de sair da conta, desativar outra conta ou reduzir seu acesso; use **Voltar** antes de repetir e confirmar. Confira perda de acesso após a desativação e preserve o último administrador ativo.
11. Repita navegação, filtros, formulário e diálogos em computador e celular. Confira foco de teclado, rolagem, rótulos e mensagens de erro.
12. Após publicar, abra o domínio real e confira os fluxos alterados, a nova versão dos assets e a persistência de contas/eventos existentes.

## Aceite dos espaços — v1.7.0

**Registro histórico:** esta seção preserva os cenários e resultados da v1.7.0, quando o local ficava fixado. A v1.7.2 corrige esse comportamento: o seletor fica editável e **Limpar filtros** remove também o local, conforme o contrato atual descrito acima e em [ESPACOS.md](ESPACOS.md).

Roteiro para executar em base local temporária; os itens numerados são resultados esperados e a evidência local aparece após os cenários. As capacidades de 300 pessoas no Auditório e 120 no Miniauditório foram informadas pelo responsável em 23/10/2026.

1. Abra **Espaços** sem login e confira cards, nomes, descrições e capacidade. Com os dois locais configurados, confirme 300 e 120 pessoas; para uma sala sem valor, confira **Capacidade não informada**.
2. Confira a fotografia do Auditório, seu crédito Univille e o link de origem de 2023. No Miniauditório e nas imagens automáticas, confira o rótulo ilustrativo e o crédito de geração por IA, sem apresentar ilustração como foto real. Confira carregamento local e texto alternativo.
3. Clique na imagem, no nome e em **Ver agenda deste espaço**. Confira a Lista com o local identificado e fixado, inclusive após limpar os demais filtros. Navegue a meses anteriores e futuros e confirme apenas aprovados do local escolhido; volte pelos cards em **Todos os espaços** e confira **Eventos** retornando ao calendário geral.
4. Como solicitante, use **Solicitar um evento** no card, **Solicitar neste espaço** na agenda e **Propor um evento** em seu estado vazio. Confira o local preenchido e sua capacidade no formulário. Feche sem salvar e repita sem sessão: entre com uma conta solicitante ou administrativa e confirme a preservação da seleção após login. Inicie outro pedido por **Minhas solicitações** e confira que ele começa sem local herdado. Confira que visitante não pode criar pedido.
5. Como administrador, edite capacidade e imagem de uma sala de teste. Confira a persistência após reabrir e recarregar; esvazie a capacidade e escolha a imagem automática. Confira o estado sem informação e a ilustração de fallback. Preserve recursos vinculados e os eventos existentes.
6. Pela API, confira omissão dos novos campos em PUT preservando seus valores, `capacity: null` e `imageKey: ""` limpando as escolhas, e respostas 400 para capacidade fracionária, negativa, fora de faixa, textual ou não finita e imagens externas/desconhecidas. Visitante, solicitante e sessão anônima não podem editar o catálogo.
7. Antes e depois da migração v4 → v5 e de sua repetição, compare contas, eventos, identificadores, versões, catálogos, fila, auditoria e vínculos. Confira `null`/chave vazia nos espaços antigos e base nova sem carga automática. Nos metadados anônimos, confira capacidade e registro de imagens sem vínculos de recursos ou campos privados.
8. Repita cards, agenda do espaço, formulário e administração em computador e celular, nos temas claro e escuro. Confira créditos legíveis, teclado, foco, controles e ausência de rolagem horizontal da página. Após a publicação autorizada, registre a versão ativa e repita os fluxos no domínio real sem alterar eventos de produção para facilitar a revisão.

Na revisão local com dados fictícios, as imagens carregaram e os cards exibiram 300/120 pessoas. O Auditório abriu a Lista com dois eventos daquele local; **Limpar filtros** manteve o espaço e seu seletor travado. No Miniauditório, a navegação encontrou eventos fictícios de setembro e de janeiro. **Eventos** retornou ao calendário geral.

Após login com administrador fictício, a solicitação reabriu com Auditório e sua capacidade preenchidos. Um pedido novo em **Minhas solicitações** começou sem local herdado. Em uma sala da base de teste, salvar capacidade 301 e a ilustração de sala pela administração refletiu os novos dados na página pública; essa alteração foi restrita à fixture local.

Em 390 × 844, os cards mantiveram a mesma geometria nos temas claro e escuro, sem rolagem horizontal da página. Os cards também foram conferidos em 320 × 844, com largura de rolagem da página igual aos 320 px disponíveis. Esses cenários não comprovam publicação concluída nem revisão de todos os dispositivos. A origem dos arquivos e o contrato de dados estão em [ESPACOS.md](ESPACOS.md).

## Aceite da navegação pública entre meses — v1.6.0

Roteiro para executar em uma base local com dados fictícios. Os itens abaixo são resultados esperados; a evidência local aparece depois dos cenários.

1. Abra a agenda sem login. Confira **Calendário** como visualização inicial, o mês atual selecionado e suas abas com os dois meses seguintes. Abra **Lista** e confirme que as três abas continuam visíveis e que o mês selecionado não mudou.
2. Escolha cada mês nas duas visualizações. Confira a grade e os cards correspondentes somente ao mês selecionado. Alterne calendário/lista e confirme o mesmo mês, mantendo busca e filtros disponíveis.
3. A partir de outubro de 2026, use **+ Próximos três meses**. Confira janeiro, fevereiro e março de 2027. Use **Três meses anteriores** para retornar. Repita para grupos passados, sem criar eventos para preencher períodos vazios.
4. Use as setas de mês para avançar de dezembro a janeiro e recuar de outubro a setembro, tanto na lista quanto no calendário. Confira o grupo correto ao cruzar sua borda. Use **Mês atual** para retornar ao mês da data corrente.
5. Selecione um dia do calendário com eventos. Confira a lista restrita à data e o mês correspondente. Combine busca, setor/curso, tema e local; **Ver todos do mês** deve remover apenas a seleção do dia, mantendo o mês e os demais filtros.
6. Consulte por HTTP `GET /api/events?month=YYYY-MM` em um período passado e outro futuro. Confira os três meses a partir do parâmetro, somente aprovados e somente campos públicos. Sem `month`, confira a janela atual de São Paulo. Informe valores inválidos e confirme a recusa, incluindo meses anteriores a `1900-01` e posteriores a `9999-10` como início de janela.
7. Confira as bordas da navegação: janeiro de 1900 e dezembro de 9999. As três abas devem continuar válidas; a última janela de API começa em `9999-10`. Os controles não devem gerar ano fora do intervalo, data inválida ou requisição impossível.
8. Repita navegação, recorte por dia, retorno ao mês atual e estados vazios em computador e celular, nos temas claro e escuro. Confira acesso por teclado, rótulos dos controles, contraste e ausência de rolagem horizontal da página.
9. Após a publicação autorizada, repita os fluxos no domínio real, identifique a versão ativa e confira a preservação dos eventos e contas existentes.

Na revisão local, as abas permaneceram na Lista e o mês de novembro foi preservado ao alternar para Calendário. Selecionar o dia 10 abriu um evento; **Ver todos do mês** retornou aos dois eventos de novembro. A navegação carregou eventos fictícios de setembro de 2026, janeiro e abril de 2027, preservou o filtro por curso e não exibiu um pendente de janeiro. Uma resposta de janeiro foi atrasada em 750 ms enquanto a interface avançava para abril; a resposta antiga não substituiu o mês atual. Uma falha HTTP 503 simulada em julho mostrou a mensagem de erro e **Tentar novamente** recuperou a consulta sem sair do mês.

Foram conferidas telas de computador, 390 × 844 e 320 × 844, sem rolagem horizontal da página. Em 320 px, os nomes visuais dos meses usam abreviações e mantêm o nome completo nos rótulos acessíveis. As posições e medidas dos cinco controles de navegação foram iguais nos temas claro e escuro após a estabilização do layout. Os limites de 1900/9999 foram verificados por testes de cálculo e HTTP; não houve navegação manual através de todos esses anos. Consultar meses futuros ou passados não inclui carga ou criação de eventos de produção.

## Aceite da seleção direta de período — v1.5.1

Roteiro para conferir a revisão do formulário; a evidência da execução local aparece após os cenários:

1. Abra Relatórios e confirme que Data inicial e Data final permanecem disponíveis, sem o campo adicional “Escolha um dia da semana desejada”.
2. Escolha **Semana atual**. Confira o preenchimento de segunda a domingo da semana corrente de São Paulo e pressione **Aplicar filtros** para atualizar tabela, legenda e links de exportação.
3. Informe manualmente `18/10/2026` e `31/10/2026`. Confira o tipo Personalizado, as datas preservadas sem realinhamento para segunda-feira e, após aplicar, o mesmo intervalo no CSV, PowerPoint e PDF.
4. Escolha **Anual · ano completo**, altere o ano e confira 1º de janeiro a 31 de dezembro. Aplique e confira o período dos downloads.
5. Use o botão separado **Semana atual**. Confira que restaura e aplica a semana da data atual de São Paulo, inclusive numa aba que permaneceu aberta durante a mudança de domingo para segunda-feira.
6. Repita o formulário em computador e celular. Confira datas legíveis, acesso a Aplicar filtros e ausência de rolagem horizontal da página.

A regra de cálculo continua sendo segunda a domingo. Esta revisão remove o campo intermediário e permite escolher o intervalo diretamente; não altera a convenção semanal.

Na revisão local, foram conferidos: dois campos de data e ausência do campo intermediário; edição pelo teclado de 18 a 31/10/2026, com tipo Personalizado e os três links usando esse intervalo; preenchimento e aplicação do ano de 2026; retorno imediato à semana atual; e layout de computador e celular de 390 × 844, sem rolagem horizontal da página. A virada de domingo para segunda foi revisada no código: o clique recalcula o dia no fuso de São Paulo, sem reutilizar a data de abertura da tela.

## Aceite da alteração de calendário e confirmações

Na v1.4.0, a revisão local usou dados inteiramente fictícios e janelas de 1280 × 720 e 390 × 844. Foram conferidos: calendário sem cards abaixo da grade; seleção de um dia abrindo a lista com um único evento; remoção do recorte retornando aos oito exemplos; aprovação, cancelamento e saída com **Voltar** preservando o estado antes da confirmação; confirmação efetiva com mensagem de sucesso; desativação de visitante somente após confirmar; preservação dos campos ao voltar para edição; edição comum direta; e abertura/retorno da exclusão de cadastro sem excluir. O estado de solicitação e de usuário foi conferido também pela API/banco local. Os botões destrutivos apresentaram fundo `rgb(180, 35, 24)` e texto `rgb(255, 255, 255)` nos temas claro e escuro. A tela de 390 px não apresentou rolagem horizontal da página e a confirmação de saída permaneceu dentro da largura disponível. Não houve alteração de senha ou mutação de dados de produção nesses testes.

O roteiro abaixo reúne os casos de aceite para futuras revisões; o registro acima identifica os casos efetivamente executados nesta versão.

| Caso                       | Procedimento e resultado esperado                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calendário inicial         | Abra a agenda em uma nova sessão. **Calendário** deve ser a aba padrão, com grade, três abas de mês e filtros; cards e resumos de eventos não devem aparecer abaixo da grade. A navegação permite consultar outros grupos de meses.                                                                                                                |
| Lista e filtros            | Abra **Lista**, pesquise e combine setor/curso, tema e local do evento. As três abas de mês continuam visíveis e os cards/resumos mostram somente o mês selecionado, respeitando os filtros. Alterne para Calendário e confira o mesmo mês.                                                                                                        |
| Seleção de dia             | Na grade, clique em uma data com eventos fictícios e depois em uma sem eventos. A interface deve abrir **Lista**, identificar a data escolhida e mostrar somente seus resultados ou o estado vazio correspondente.                                                                                                                                 |
| Limpar o dia               | Com uma data selecionada, clique em **Ver todos do mês**. O recorte daquela data deve ser removido e a lista deve voltar a considerar somente o mês selecionado, respeitando busca e demais filtros ativos.                                                                                                                                        |
| Ações destrutivas          | Exercite **Sair da conta**, cancelar um pendente próprio, cancelar um aprovado como administrador, excluir um rascunho, rejeitar uma solicitação com motivo, desativar uma conta e reduzir seu acesso. Cada ação deve abrir confirmação, explicar a operação e oferecer **Voltar**. O botão de confirmação deve ter fundo vermelho e texto branco. |
| Voltar sem executar        | Em cada confirmação destrutiva, escolha **Voltar**. Confira que a sessão, o registro, o estado ou o acesso continuam como antes e que a operação não foi enviada ao servidor. Reabra para testar a confirmação efetiva.                                                                                                                            |
| Aprovar/publicar           | Abra a aprovação de uma solicitação válida. A confirmação deve apresentar a publicação resultante e usar ação positiva verde. Volte sem executar e depois confirme; o evento só deve aparecer na agenda pública após o sucesso da aprovação.                                                                                                       |
| Andamento e resultado      | Em uma cópia local com dados fictícios, use atraso e falha de rede para conferir o indicador de andamento e o bloqueio de cliques repetidos. Após sucesso, confira a mensagem e o estado atualizado. Após erro, confira a mensagem, a ausência de sucesso indevido e a possibilidade de tentar novamente.                                          |
| Salvar comum               | Salve uma alteração de formulário que não seja destrutiva. Confira o estado ocupado durante a solicitação e a mensagem de sucesso ou erro, mantendo o fluxo de salvamento sem confirmação adicional.                                                                                                                                               |
| Desktop, celular e teclado | Repita calendário, seleção/limpeza de dia e confirmações em computador e celular. Confira foco no diálogo, acesso aos botões por teclado, contraste dos botões vermelhos com texto branco, legibilidade da ação verde e ausência de rolagem horizontal da página.                                                                                  |

As confirmações da interface não substituem as verificações de permissão, vínculo, conflito e preservação do último administrador no servidor. Inclua casos recusados pelo servidor para conferir a apresentação do erro e a manutenção do estado anterior.

## Medição isolada das listagens

Uma medição HTTP em `127.0.0.1`, com **300 eventos fictícios**, Mac M4 Pro e Node **24.19**, executou **460 requisições sem falhas**. A otimização carrega eventos e recursos em duas consultas, eliminando consultas adicionais por evento.

| Cenário                      | p50 após otimização | p95 após otimização | p95 anterior |
| ---------------------------- | ------------------- | ------------------- | ------------ |
| Requisições sequenciais      | 4,219 ms            | 4,584 ms            | 17,116 ms    |
| Dez requisições concorrentes | 30,233 ms           | 48,673 ms           | 228,736 ms   |

O cenário é isolado, sem a rede pública, Nginx ou o hardware de produção. Os números servem para comparar a implementação antes/depois, não para prever a experiência de todos os usuários. O caso concorrente também mostra que a referência de 20 ms não é uma garantia geral.

## Limites da evidência

Testes funcionais e medições locais não são auditoria independente de segurança, teste amplo de carga ou certificação de acessibilidade. A referência de 20 ms não é um SLA implementado; latência varia com volume, concorrência, rede, servidor e dispositivo e precisa ser medida nessas condições.

Não foi validada entrega SMTP real, pois o provedor ainda não foi configurado. Login institucional, recuperação automática de senha por e-mail, participantes e emissão de certificados permanecem fora do escopo implementado. O sistema inicializa sem dados de demonstração. A carga dos oito exemplos fictícios depende da execução explícita do operador, conforme [DEMONSTRACAO.md](DEMONSTRACAO.md); não é executada por migração, build ou testes.
