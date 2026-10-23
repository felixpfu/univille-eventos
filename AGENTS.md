# Instruções para este projeto

Este repositório mantém a Agenda de Eventos do grupo !Null para a Univille, campus São Bento do Sul.

## Autorização de atualização

Em 23/10/2026, o responsável autorizou explicitamente: “Tudo que for feito a partir de agora vai para o github e publicado ao flxpfu.com.br”. Para alterações solicitadas neste projeto, concluir implementação, verificações, commit/push em `https://github.com/felixpfu/univille-eventos` e publicação na raiz de `https://flxpfu.com.br/`. Não solicitar novamente aprovação para esse fluxo já autorizado. Essa autorização não estende o trabalho a alterações não solicitadas, exclusão de dados ou configuração de um provedor externo sem os dados necessários.

## Antes de publicar

- Leia os requisitos e os procedimentos em `docs/` e inspecione o estado atual do repositório.
- Execute testes apropriados, `npm test`, `npm run build` e `npm audit --omit=dev`. Investigue falhas ou vulnerabilidades relevantes antes da publicação.
- Revise interface no navegador quando houver mudanças visuais e valide migrações preservando dados existentes.
- Use os scripts de release, mantenha backup consistente e verifique a versão ativa, `/api/health`, a página e os fluxos alterados após publicar.
- Informe com precisão o que foi publicado e eventuais dependências ainda sem configuração. Não declare envio SMTP real sem teste autorizado e entrega verificada.

## Dados e credenciais

Nunca inclua no GitHub `.env` real, senhas privadas, chaves privadas, tokens, cookies, banco, snapshots, filas operacionais ou fotografias/anexos privados fornecidos pelo responsável. Utilize dados fictícios em testes e mantenha segredos operacionais apenas no arquivo protegido do servidor. Não exponha credenciais privadas em logs, comandos ou capturas de tela.

Exceção expressa: em 23/10/2026, o responsável confirmou que deseja **publicar as três contas atuais de demonstração, incluindo administrador**, com aviso de uso exclusivo para testes. Somente os e-mails e senhas dessas três contas, listados em **Acessos para apresentação** no README, são públicos por essa autorização. Preserve o aviso de acesso compartilhado e das permissões administrativas; não amplie a exceção a outras contas ou segredos. Essa decisão não muda perfis, senhas ou permissões da aplicação.

Não substitua a base publicada por dados locais e não apague solicitações para facilitar testes. Preserve o site anterior e releases necessários à reversão. O provedor de e-mail permanece sem configuração até o responsável fornecer a definição necessária; a disponibilidade deve continuar explícita na interface.
