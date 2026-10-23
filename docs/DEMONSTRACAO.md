# Eventos fictícios de demonstração

Este documento descreve o conjunto e os scripts históricos de carga e atualização de locais. Após a solicitação de acabamento institucional, os textos e nomes exibidos podem ser atualizados pelo procedimento de [conteúdo para apresentação](APRESENTACAO.md), preservando os oito registros e sua origem interna. Depois dessa atualização, os scripts históricos devem interromper ao encontrar diferenças; não são uma forma de restaurar os textos antigos.

O responsável solicitou exemplos públicos com horários variados, descrição e participação por curso e semestre. O conjunto versionado em `scripts/demo-events.json` contém oito eventos entre **26/10 e 02/12/2026**, cobrindo manhã, tarde e noite. Os títulos e cursos mantêm “· Demonstração”; o tema é “Demonstração acadêmica”. As descrições informam explicitamente que os eventos são fictícios. Esses exemplos **não representam programação oficial nem confirmam a oferta dos cursos no campus**.

Os locais usam os nomes exatos **Auditório** e **Miniauditório**, informados pelo responsável para o campus São Bento do Sul. Não são atribuídas capacidades, equipamentos ou outras características não fornecidas. Os eventos não solicitam recursos desses locais.

| Data       | Horário     | Evento                                   | Local         | Curso de exemplo       | Semestres   |
| ---------- | ----------- | ---------------------------------------- | ------------- | ---------------------- | ----------- |
| 26/10/2026 | 08h–10h     | Oficina de protótipos digitais           | Miniauditório | Engenharia de Software | 1º, 3º e 5º |
| 27/10/2026 | 14h–16h     | Laboratório de empreendedorismo criativo | Auditório     | Administração          | 2º e 4º     |
| 28/10/2026 | 19h–21h     | Roda de conversa sobre cidadania digital | Auditório     | Direito                | 4º e 6º     |
| 29/10/2026 | 09h–11h     | Vivência de escuta e acolhimento         | Miniauditório | Psicologia             | 3º e 5º     |
| 30/10/2026 | 15h–17h     | Finanças na prática: orçamento simulado  | Miniauditório | Ciências Contábeis     | 2º e 6º     |
| 03/11/2026 | 18h30–20h30 | Desafio de processos sustentáveis        | Auditório     | Engenharia de Produção | 4º e 8º     |
| 10/11/2026 | 10h–12h     | Encontro sobre qualidade de software     | Miniauditório | Engenharia de Software | 5º e 7º     |
| 02/12/2026 | 19h–21h     | Seminário de planejamento e equipes      | Auditório     | Administração          | 6º e 8º     |

## Operação

`node scripts/seed-demo.js` mostra o plano sem autenticar, acessar o banco ou alterar o servidor. `--origin` aceita apenas `https://flxpfu.com.br` ou origem HTTP/HTTPS em `localhost`, `127.0.0.1` ou `[::1]`, com porta local opcional, sem caminho, usuário ou senha na URL. Redirecionamentos são rejeitados para evitar envio de credenciais a outro destino.

A publicação exige `--publish` e credenciais administrativas por **JSON na entrada padrão**, fornecidas por um gerenciador de segredos ou processo local protegido. Nunca inclua senha em argumentos, histórico do terminal, logs, arquivo versionado ou captura. Estrutura esperada: objeto com as propriedades `email` e `password`. O script não registra credenciais nem cookies e tenta encerrar a sessão ao finalizar. Exemplo de comando sem credenciais: `node scripts/seed-demo.js --origin https://flxpfu.com.br --publish`, com a entrada padrão conectada à fonte protegida.

Antes de executar em produção, gere um backup consistente do banco pelo procedimento de publicação e confirme que a versão ativa implementa `publicDescription`, `audienceCourseId` e `audienceSemester`. Valide antes em uma base local temporária. A aprovação segue a API normal: criação do rascunho, envio e aprovação administrativa, com validação de conflitos, prioridade e auditoria. Se houver notificações habilitadas no futuro, a aprovação poderá gerar os avisos normais para pessoas que consentiram.

O script cria os catálogos fictícios necessários, os dois locais informados quando ausentes e oito pedidos. Salas existentes com os nomes exatos são reaproveitadas sem alterar seus recursos ou descrição. As observações internas identificam cada exemplo por `DEMO_UNIVILLE_2026_V1` e uma chave estável. Execuções sequenciais reaproveitam registros idênticos: aprovados são ignorados e rascunhos/pendentes são retomados. Não execute duas instâncias simultaneamente. A API não impõe uma chave de idempotência ao operador; por isso a checagem não protege execuções concorrentes.

Qualquer colisão de nome, mudança nos dados existentes, estado rejeitado/cancelado, conflito de horário ou erro da API interrompe a operação para revisão. Nenhum registro existente é editado, substituído ou excluído pelo script. Se a execução for interrompida, os catálogos e pedidos já criados permanecem identificados; uma nova execução pode retomá-los. Alterações e remoções posteriores dos exemplos devem ser feitas conscientemente pela administração. Não use o script para substituir a base de produção por dados locais.

## Atualização dos locais já publicados

Para os oito exemplos criados antes da definição dos locais, use `node scripts/update-demo-venues.js`. Sem `--publish`, o script mostra uma prévia anônima do local planejado para cada evento, sem autenticar, acessar o servidor ou alterar dados. As restrições de origem e redirecionamento são as mesmas do seed.

A execução que altera dados exige `node scripts/update-demo-venues.js --origin https://flxpfu.com.br --publish`, com o objeto JSON de `email` e `password` na entrada padrão protegida. Nunca coloque credenciais nos argumentos. Faça um **backup consistente do banco antes da atualização** e valide o fluxo em uma base local temporária. Execute apenas uma instância por vez.

Antes da primeira alteração, o script verifica os oito marcadores, a aprovação, a autoria administrativa, a versão, os dados do conjunto e os catálogos relacionados. Mudanças nos títulos, descrições, cursos, semestres ou demais campos, registros ambíguos ou conflito com outro evento aprovado interrompem a operação. Somente esses oito eventos identificados podem ser atualizados; outros pedidos não são editados.

O script reaproveita ou cria **Auditório** e **Miniauditório** sem recursos presumidos. Pela API normal, atualiza o local de cada exemplo e remove a solicitação do recurso fictício anteriormente associado, mantendo os demais campos. A API verifica versão e conflito, registra auditoria e pode gerar os avisos normais de publicação para pessoas que consentiram, conforme a configuração de e-mail. Os catálogos antigos de salas de demonstração e do projetor permanecem preservados.

Repetir a atualização depois de concluída deve resultar em **oito eventos já corretos**, sem novos pedidos, mudanças de versão ou novas atualizações. Uma interrupção preserva as operações confirmadas; após resolver a causa, o script reconhece os eventos já atualizados. Executar `seed-demo.js --publish` após a atualização também deve ignorar os oito aprovados idênticos, sem duplicá-los. O seed não faz essa migração: se os eventos ainda estiverem nos locais antigos, ele interrompe ao detectar a diferença.
