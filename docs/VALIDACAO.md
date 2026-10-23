# Validação

Registro da revisão de **23/10/2026**. Os testes usam dados fictícios e bancos temporários; não dependem de contas ou eventos da produção. Requisitos e limites estão em [REQUISITOS.md](REQUISITOS.md).

## Verificações automatizadas

Após `npm ci`, execute na raiz do projeto:

```bash
npm test
npm run build
npm audit --omit=dev
```

A revisão funcional registrou **24 testes aprovados**: 12 de backend, sete de notificações, três de PowerPoint e dois de regressão das listagens. A auditoria de produção, repetida após fixar `image-size` em `2.0.4` via override, informou **zero vulnerabilidades conhecidas** nessa execução. Essa conclusão se refere às dependências e à base de avisos consultada; deve ser reavaliada a cada atualização.

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

O roteiro deve ser repetido após mudanças visuais ou de fluxo. Essas verificações pontuais não constituem uma suíte permanente de navegador nem uma avaliação completa em todos os dispositivos.

A apresentação foi reconstruída a partir da fotografia. Na revisão de 23/10/2026, apresentações fictícias com seis eventos, período vazio e campo longo foram renderizadas com LibreOffice e todos os slides foram inspecionados. Foram conferidos cabeçalho, tabela, rodapé, legibilidade e continuação. Isso não prova identidade exata com o PPTX original, que não foi fornecido. Detalhes em [PPTX.md](PPTX.md).

## Publicação e integridade de dados

O pacote de release executa testes e build antes da transferência. O instalador usa dependências de produção pelo lockfile, mantém os dados fora das releases e verifica `/api/health` e a página em localhost. Com `--publish`, também verifica ambos pelo HTTPS e hostname reais. O registro da publicação deve identificar o commit/release efetivamente ativo e o resultado das verificações, sem credenciais.

Antes do snapshot SQLite, o instalador interrompe o serviço web e o worker de e-mail. A migração v2 é aditiva; cópia de base de desenvolvimento não integra a publicação. O timer SMTP só é habilitado quando a configuração necessária está disponível. Nesta entrega, não há provedor definido e o timer permanece desativado. Procedimentos em [DEPLOYMENT.md](DEPLOYMENT.md).

## Roteiro de aceite

Use dados fictícios e sessões separadas de visitante, solicitante e administrador.

1. Sem login, confira o campus, a marca, o calendário inicial, a aba de lista, os três meses permitidos e filtros. Confirme a ausência de informações internas na agenda pública.
2. Cadastre centro de custo, recurso, ambiente com recurso, setor/curso com centro e tema. Confirme as restrições de exclusão por vínculo.
3. Crie solicitante e visitante; confira que não há cadastro público de administrador e que os perfis não acessam ações alheias.
4. Salve e reabra rascunho incompleto. Complete **Realização**, curso/semestre do público quando cabíveis, centro automático e respostas Sim/Não.
5. Envie dois pendentes conflitantes. Tente aprovar o segundo primeiro e confira a recusa indicando o protocolo anterior. Rejeite o primeiro, confira o motivo para o autor e teste reenvio com nova posição.
6. Corrija apenas o título de um pendente e confira a posição preservada. Mude local/data/horário e confira a nova posição. Após aprovação, confirme a agenda e os bloqueios de sobreposição.
7. Edite/cancele um aprovado como administrador; cancele um pendente próprio e exclua um rascunho próprio. Confira a preservação dos registros enviados.
8. Nos relatórios, escolha semana, ano e período personalizado; combine setor, tema e estado. Compare tabela/CSV. Abra o PowerPoint e confira as oito colunas, só aprovados, identidade visual e várias páginas quando necessário.
9. Na conta, salve/desative notificações. Sem SMTP, confira o aviso de indisponibilidade e que não há alegação de envio. A confirmação por link e entrega real devem ser aceitas separadamente, após configurar um provedor e autorizar uma conta de teste.
10. Troque a senha e confirme a revogação de sessões antigas. Desative uma conta e confira perda de acesso; preserve o último administrador ativo.
11. Repita navegação, filtros, formulário e diálogos em computador e celular. Confira foco de teclado, rolagem, rótulos e mensagens de erro.
12. Após publicar, abra o domínio real e confira os fluxos alterados, a nova versão dos assets e a persistência de contas/eventos existentes.

## Medição isolada das listagens

Uma medição HTTP em `127.0.0.1`, com **300 eventos fictícios**, Mac M4 Pro e Node **24.19**, executou **460 requisições sem falhas**. A otimização carrega eventos e recursos em duas consultas, eliminando consultas adicionais por evento.

| Cenário                      | p50 após otimização | p95 após otimização | p95 anterior |
| ---------------------------- | ------------------- | ------------------- | ------------ |
| Requisições sequenciais      | 4,219 ms            | 4,584 ms            | 17,116 ms    |
| Dez requisições concorrentes | 30,233 ms           | 48,673 ms           | 228,736 ms   |

O cenário é isolado, sem a rede pública, Nginx ou o hardware de produção. Os números servem para comparar a implementação antes/depois, não para prever a experiência de todos os usuários. O caso concorrente também mostra que a referência de 20 ms não é uma garantia geral.

## Limites da evidência

Testes funcionais e medições locais não são auditoria independente de segurança, teste amplo de carga ou certificação de acessibilidade. A referência de 20 ms não é um SLA implementado; latência varia com volume, concorrência, rede, servidor e dispositivo e precisa ser medida nessas condições.

Não foi validada entrega SMTP real, pois o provedor ainda não foi configurado. Login institucional, recuperação automática de senha por e-mail, participantes e emissão de certificados permanecem fora do escopo implementado. O sistema inicializa sem dados de demonstração; a equipe deve cadastrar os catálogos antes do primeiro pedido.
