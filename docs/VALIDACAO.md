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

| Grupo                     | Evidências                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autenticação e permissões | Hash de senha, sessões, origem/CSRF, cookies de produção, propriedade de pedidos, desativação e expiração.                                                        |
| Fluxo de pedidos          | Rascunho incompleto, envio, rejeição motivada, correção/reenvio, aprovação, cancelamento e exclusão restrita.                                                     |
| Agenda e concorrência     | Datas/horários e recursos inválidos, conflitos, horários adjacentes, ambientes distintos e aprovação concorrente.                                                 |
| Fila de prioridade        | Rascunho antigo não ganha prioridade; envio decide, inclusive no mesmo milissegundo. Correções preservam posição; mudanças de reserva e reenvio a reiniciam.      |
| Campos e relatórios       | Realização obrigatória no envio, curso/semestre do público, filtros de estado, proteção do PPTX e exportação apenas de aprovados.                                 |
| Migração v1 → v2          | Preservação de contas/eventos/auditoria, reconstrução pelo envio mais recente, fallback histórico documentado e reaplicação idempotente.                          |
| Persistência e CLI        | Base inicial vazia, reinicialização sem perda, integridade referencial e provisionamento através do symlink de release usado na produção.                         |
| Notificações              | Sem inscrição automática; destinatário da própria conta; indisponibilidade explícita sem SMTP; confirmação, expiração, uso único e descadastro.                   |
| Processamento de e-mail   | Preferências e setor, retirada de consentimento antes do envio, versões/cancelamentos, fuso de São Paulo, deduplicação, retentativas e erros sem dados sensíveis. |
| Listagens                 | Volume e conteúdo da listagem permanecem corretos; eventos e recursos são carregados em duas consultas, sem uma consulta adicional por evento.                    |
| Arquivo PowerPoint        | ZIP/OOXML válido, oito colunas editáveis, logo oficial, ordenação, datas, escape XML, período vazio, paginação e preservação de textos longos.                    |

As integrações do backend utilizam servidor HTTP e SQLite reais. Somente o transporte SMTP é simulado: **nenhum teste envia e-mail**. Os testes de PPTX inspecionam o arquivo produzido. O CI instala pelo lockfile, testa e compila com Node 24; não publica e não contém credenciais de produção.

## Interface e documentos

A revisão no navegador usou janelas de **1440 × 1000** e **390 × 844**, sem rolagem horizontal da página. Foram conferidos calendário inicial, navegação em lista, aplicação de período anual de 1º de janeiro a 31 de dezembro, download semanal de PowerPoint pela interface e salvamento do consentimento com o aviso explícito de SMTP indisponível. As telas utilizam São Bento do Sul, a marca institucional original e tema claro padrão.

Na v1.2.0, foram conferidos os dois fluxos de cadastro, a recusa de CNPJ inválido e sua correção sem duplicar a conta, e a consulta administrativa de empresa/CNPJ. A revisão visual usou 1440 × 1000, 390 × 844 e 320 × 844. Na comparação entre claro/escuro, 52 elementos do cabeçalho/calendário em desktop mantiveram as mesmas medidas e posições; o cabeçalho e os elementos comparados em celular e administração também permaneceram alinhados. Não houve rolagem horizontal da página nos cenários conferidos. A tipografia usa corpo e campos de 16 px ou mais, controles de 14–16 px e auxiliares de no mínimo 12 px.

Na v1.3.0, foram conferidos os oito eventos fictícios com manhã/tarde/noite e suas descrições, cursos e vários semestres. A carga via API aprovou oito pedidos; uma segunda execução ignorou os oito sem criar duplicações. A revisão em desktop e celular conferiu lista, calendário e diálogo de detalhes com descrição e participantes. O teste de backend verifica que apenas aprovados são públicos e que objetivo, justificativa, observações e dados de conta não vazam. A migração v4 preserva registros sem preencher descrições a partir de textos internos.

Na v1.3.1, os oito exemplos anteriores foram atualizados via API para Auditório e Miniauditório, mantendo os mesmos IDs, conteúdo, cursos, semestres e horários. Foram criados dois locais sem presumir recursos ou capacidade; os catálogos antigos permaneceram intactos. A segunda execução do atualizador e a repetição do seed ignoraram os oito registros, sem novas versões ou duplicações. O filtro público e o cadastro priorizam as duas opções sob o rótulo “Local do evento”. A ordem das opções foi conferida no navegador.

O roteiro deve ser repetido após mudanças visuais ou de fluxo. Essas verificações pontuais não constituem uma suíte permanente de navegador nem uma avaliação completa em todos os dispositivos.

A apresentação foi reconstruída a partir da fotografia. Na revisão de 23/10/2026, apresentações fictícias com seis eventos, período vazio e campo longo foram renderizadas com LibreOffice e todos os slides foram inspecionados. Foram conferidos cabeçalho, tabela, rodapé, legibilidade e continuação. Isso não prova identidade exata com o PPTX original, que não foi fornecido. Detalhes em [PPTX.md](PPTX.md).

## Publicação e integridade de dados

O pacote de release executa testes e build antes da transferência. O instalador usa dependências de produção pelo lockfile, mantém os dados fora das releases e verifica `/api/health` e a página em localhost. Com `--publish`, também verifica ambos pelo HTTPS e hostname reais. O registro da publicação deve identificar o commit/release efetivamente ativo e o resultado das verificações, sem credenciais.

Antes do snapshot SQLite, o instalador interrompe o serviço web e o worker de e-mail. As migrações v2, v3 e v4 são aditivas; cópia de base de desenvolvimento não integra a publicação. O timer SMTP só é habilitado quando a configuração necessária está disponível. Nesta entrega, não há provedor definido e o timer permanece desativado. Procedimentos em [DEPLOYMENT.md](DEPLOYMENT.md).

## Roteiro de aceite

Use dados fictícios e sessões separadas de visitante, solicitante e administrador.

1. Sem login, confira o campus, a marca e a aba **Calendário** inicial com grade, três meses e filtros. Confira cards/resumos somente na aba **Lista**. Clique em um dia, confirme a lista restrita à data e use **Ver todos** para limpar esse recorte. Confirme a ausência de informações internas na agenda pública.
2. Cadastre centro de custo, recurso, ambiente com recurso, setor/curso com centro e tema. Confirme as restrições de exclusão por vínculo.
3. Em Criar conta, confira a escolha inicial de perfil sem campos ou perfil pré-selecionado. Cadastre visitante só com e-mail/senha e solicitante com nome, e-mail, senha, empresa e CNPJ. Confira recusa de CNPJ inválido, persistência dos dados empresariais e sua ausência na agenda pública. Verifique que não há cadastro público de administrador e que os perfis não acessam ações alheias.
4. Salve e reabra rascunho incompleto. Complete **Realização**, curso/semestre do público quando cabíveis, centro automático e respostas Sim/Não.
5. Envie dois pendentes conflitantes. Tente aprovar o segundo primeiro e confira a recusa indicando o protocolo anterior. Rejeite o primeiro, confira o motivo para o autor e teste reenvio com nova posição.
6. Corrija apenas o título de um pendente e confira a posição preservada. Mude local/data/horário e confira a nova posição. Após aprovação, confirme a agenda e os bloqueios de sobreposição.
7. Edite/cancele um aprovado como administrador; cancele um pendente próprio e exclua um rascunho próprio. Confira as confirmações de cancelamento e exclusão, a opção de voltar sem executar e a preservação dos registros enviados.
8. Nos relatórios, escolha semana, ano e período personalizado; combine setor, tema e estado. Compare tabela/CSV. Abra o PowerPoint e confira as oito colunas, só aprovados, identidade visual e várias páginas quando necessário.
9. Na conta, salve/desative notificações. Sem SMTP, confira o aviso de indisponibilidade e que não há alegação de envio. A confirmação por link e entrega real devem ser aceitas separadamente, após configurar um provedor e autorizar uma conta de teste.
10. Troque a senha e confirme a revogação de sessões antigas. Confira as confirmações antes de sair da conta, desativar outra conta ou reduzir seu acesso; use **Voltar** antes de repetir e confirmar. Confira perda de acesso após a desativação e preserve o último administrador ativo.
11. Repita navegação, filtros, formulário e diálogos em computador e celular. Confira foco de teclado, rolagem, rótulos e mensagens de erro.
12. Após publicar, abra o domínio real e confira os fluxos alterados, a nova versão dos assets e a persistência de contas/eventos existentes.

## Aceite da alteração de calendário e confirmações

Na v1.4.0, a revisão local usou dados inteiramente fictícios e janelas de 1280 × 720 e 390 × 844. Foram conferidos: calendário sem cards abaixo da grade; seleção de um dia abrindo a lista com um único evento; remoção do recorte retornando aos oito exemplos; aprovação, cancelamento e saída com **Voltar** preservando o estado antes da confirmação; confirmação efetiva com mensagem de sucesso; desativação de visitante somente após confirmar; preservação dos campos ao voltar para edição; edição comum direta; e abertura/retorno da exclusão de cadastro sem excluir. O estado de solicitação e de usuário foi conferido também pela API/banco local. Os botões destrutivos apresentaram fundo `rgb(180, 35, 24)` e texto `rgb(255, 255, 255)` nos temas claro e escuro. A tela de 390 px não apresentou rolagem horizontal da página e a confirmação de saída permaneceu dentro da largura disponível. Não houve alteração de senha ou mutação de dados de produção nesses testes.

O roteiro abaixo reúne os casos de aceite para futuras revisões; o registro acima identifica os casos efetivamente executados nesta versão.

| Caso | Procedimento e resultado esperado |
| --- | --- |
| Calendário inicial | Abra a agenda em uma nova sessão. **Calendário** deve ser a aba padrão, com grade, navegação dos três meses e filtros; cards e resumos de eventos não devem aparecer abaixo da grade. |
| Lista e filtros | Abra **Lista**, pesquise e combine setor/curso, tema e ambiente. Os cards/resumos devem aparecer nesta aba e respeitar os filtros. Alterne para Calendário e confira a grade e os filtros disponíveis. |
| Seleção de dia | Na grade, clique em uma data com eventos fictícios e depois em uma sem eventos. A interface deve abrir **Lista**, identificar a data escolhida e mostrar somente seus resultados ou o estado vazio correspondente. |
| Limpar o dia | Com uma data selecionada, clique em **Ver todos**. O recorte daquela data deve ser removido e a lista deve voltar a considerar o período disponível, respeitando os demais filtros ativos. |
| Ações destrutivas | Exercite **Sair da conta**, cancelar um pendente próprio, cancelar um aprovado como administrador, excluir um rascunho, rejeitar uma solicitação com motivo, desativar uma conta e reduzir seu acesso. Cada ação deve abrir confirmação, explicar a operação e oferecer **Voltar**. O botão de confirmação deve ter fundo vermelho e texto branco. |
| Voltar sem executar | Em cada confirmação destrutiva, escolha **Voltar**. Confira que a sessão, o registro, o estado ou o acesso continuam como antes e que a operação não foi enviada ao servidor. Reabra para testar a confirmação efetiva. |
| Aprovar/publicar | Abra a aprovação de uma solicitação válida. A confirmação deve apresentar a publicação resultante e usar ação positiva verde. Volte sem executar e depois confirme; o evento só deve aparecer na agenda pública após o sucesso da aprovação. |
| Andamento e resultado | Em uma cópia local com dados fictícios, use atraso e falha de rede para conferir o indicador de andamento e o bloqueio de cliques repetidos. Após sucesso, confira a mensagem e o estado atualizado. Após erro, confira a mensagem, a ausência de sucesso indevido e a possibilidade de tentar novamente. |
| Salvar comum | Salve uma alteração de formulário que não seja destrutiva. Confira o estado ocupado durante a solicitação e a mensagem de sucesso ou erro, mantendo o fluxo de salvamento sem confirmação adicional. |
| Desktop, celular e teclado | Repita calendário, seleção/limpeza de dia e confirmações em computador e celular. Confira foco no diálogo, acesso aos botões por teclado, contraste dos botões vermelhos com texto branco, legibilidade da ação verde e ausência de rolagem horizontal da página. |

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
