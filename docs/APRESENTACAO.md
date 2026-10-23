# Conteúdo dos eventos para apresentação

O responsável solicitou que os oito exemplos tenham textos e cadastros com acabamento institucional, sem os rótulos “Demonstração” ou “fictício” na agenda. O conteúdo está em `scripts/event-presentation.json`. Os exemplos continuam sendo dados preparados para apresentação, e não uma programação oficial verificada. A origem permanece nas observações internas e neste registro; nomes de professores, parceiros, patrocínios e certificações não foram inventados.

Cada evento recebe título, tema, descrição pública, público-alvo, equipe responsável, realização, objetivo e justificativa coerentes com sua atividade. Curso, semestres, datas, horários e os locais Auditório/Miniauditório permanecem os mesmos. Equipes funcionais substituem o texto genérico “Equipe de demonstração”.

## Atualização dos oito registros existentes

`node scripts/update-event-presentation.js` mostra uma prévia sem autenticar nem alterar dados. `--publish` aplica o plano pela API normal, utilizando credenciais administrativas em um objeto JSON pela entrada padrão protegida. Nunca informe senha em argumentos, histórico do terminal ou arquivos versionados. A origem aceita é `https://flxpfu.com.br`, ou uma origem local HTTP/HTTPS válida, sem redirecionamentos.

Antes de aplicar, faça backup consistente pelo procedimento de [publicação](DEPLOYMENT.md) e teste em base temporária. Execute somente uma instância por vez. O operador deve usar a conta administrativa autora dos oito exemplos. O script valida todos os marcadores internos, conteúdo de origem ou já atualizado, aprovação, autoria, referências e colisões antes da primeira alteração. Alterações manuais incompatíveis interrompem a execução para revisão, preservando os dados existentes.

O plano renomeia os seis cursos para seus nomes sem o sufixo de demonstração e o tema/centro de custo compartilhados para “Atividades acadêmicas”, mantendo os identificadores. Também prepara os temas específicos usados pelos oito eventos. Como os cadastros são compartilhados, seus nomes atualizados aparecem nos filtros e nos demais eventos que já os referenciam, sem alterar os vínculos desses registros.

Os oito eventos são editados com verificação de versão. Identificadores, autor, aprovação, ordem de envio, data, horário, local, cursos, semestres, recursos e observações internas são preservados. Nenhum campo armazenado de outro evento é editado. O evento cadastrado pelo responsável deve permanecer com seu título e descrição originais, conforme sua escolha explícita.

Uma repetição reconhece os registros já corretos e não deve criar novos eventos, catálogos, versões ou edições de auditoria. Uma execução interrompida pode ser retomada após resolver a causa; operações já confirmadas permanecem registradas. As alterações passam pela auditoria normal e podem gerar avisos de publicação no futuro, se houver SMTP e destinatários que tenham consentido. Nesta entrega, o SMTP continua sem configuração e o timer permanece desativado.

## Carga inicial e histórico

`seed-demo.js` e `update-demo-venues.js` preservam o conjunto histórico descrito em [DEMONSTRACAO.md](DEMONSTRACAO.md). Em uma base nova, cadastre os exemplos primeiro e aplique a apresentação depois. Após atualizar a apresentação, não use os scripts históricos para desfazer o conteúdo: suas verificações devem interromper ao encontrar os dados diferentes do plano legado. Não há carga automática ao iniciar, migrar ou publicar o sistema.

A reversão de uma release de código não desfaz essas edições de conteúdo. Não restaure toda a base para voltar apenas os textos, pois isso poderia descartar registros posteriores; utilize edição controlada pela API, preservando os demais dados e a auditoria.
