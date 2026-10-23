# Notificações por e-mail

Visitantes e solicitantes podem optar por receber publicações e lembretes na própria conta. Nenhum endereço é inscrito apenas por ter se cadastrado. O destinatário é sempre o e-mail da conta autenticada; não existe formulário público para inscrever terceiros.

O usuário salva as preferências, solicita um link e confirma a propriedade do endereço. O link é de uso único, expira em 24 horas e só altera a conta após a confirmação explícita na página. O filtro opcional de setor usa o curso/coordenação do evento. Alterar o endereço da conta exige uma nova confirmação.

Após aprovação ou alteração de um evento aprovado, a fila registra a confirmação do solicitante e a publicação para assinantes que aceitaram receber novos eventos. A confirmação do próprio agendamento segue a preferência de novos eventos; aceitar somente lembretes não autoriza essa confirmação. O solicitante recebe uma confirmação por versão, sem receber outra publicação do mesmo evento. Lembretes são gerados no dia do evento, antes do horário inicial, no fuso `America/Sao_Paulo`. Cancelamentos, versões desatualizadas, contas desativadas, mudança de e-mail e retirada do consentimento impedem envios ainda não iniciados. Uma mensagem já entregue ao servidor SMTP não pode ser recolhida.

## Disponibilidade

Sem SMTP válido, a interface informa a indisponibilidade e permite salvar ou desativar as preferências. O sistema não informa que enviou uma mensagem que apenas entrou na fila. A confirmação de endereço também fica indisponível enquanto o SMTP não estiver configurado.

Configure exclusivamente no arquivo protegido do servidor `/etc/univille-eventos.env`, sem colocar segredos no GitHub:

```dotenv
PUBLIC_ORIGIN=https://flxpfu.com.br
SMTP_HOST=smtp.exemplo.invalid
SMTP_PORT=587
SMTP_SECURE=false
SMTP_FROM=agenda@exemplo.invalid
SMTP_USER=usuario-fornecido-pelo-provedor
SMTP_PASS=senha-fornecida-pelo-provedor
```

`SMTP_FROM` deve ser um endereço simples, autorizado pelo provedor. Porta 587 usa STARTTLS obrigatório; porta 465 normalmente usa `SMTP_SECURE=true`. TLS exige certificado válido. Usuário e senha precisam ser preenchidos juntos, salvo relay autenticado pela infraestrutura, em que ambos podem ficar ausentes. O arquivo de ambiente deve continuar restrito a root e ao serviço (`0640` ou mais restritivo). Reinicie o serviço web após mudanças. Ajuste SPF, DKIM e DMARC no provedor de e-mail para o domínio remetente; o aplicativo não altera DNS de e-mail.

Não são enviados e-mails durante build, testes ou publicação. Os testes usam exclusivamente um transporte simulado. Ative o processamento real apenas após configurar e validar o provedor com uma conta de teste autorizada.

## Processamento

Instale `deploy/univille-notifications.service` e `deploy/univille-notifications.timer` em `/etc/systemd/system/`, execute `systemctl daemon-reload` e habilite o timer com `systemctl enable --now univille-notifications.timer` após a configuração SMTP. O timer processa a fila a cada cinco minutos, com pequena variação de agendamento. Sem configuração válida, o comando termina com um aviso operacional sem abrir conexão SMTP.

O comando é `node scripts/process-notifications.js`, executado no diretório da versão publicada, com o mesmo `DATA_DIR` e arquivo de ambiente do serviço web. Não rode manualmente apontando para produção sem intenção de enviar as mensagens elegíveis da fila.

A fila SQLite possui chave única por tipo/evento/versão/usuário/data, trava de worker e recuperação de tarefas interrompidas. Falhas têm até cinco tentativas, com espera exponencial. A consulta atual do evento e do consentimento ocorre antes de cada envio. O protocolo SMTP não oferece uma transação única com o banco: uma queda após o servidor aceitar a mensagem, antes de registrar o sucesso local, pode resultar em reenvio na recuperação. O identificador da mensagem permanece estável para ajudar a identificação de duplicatas.

O journal registra contadores agregados e códigos de erro, nunca senhas SMTP, tokens ou corpo das mensagens. Tokens são aleatórios e apenas seus hashes ficam no banco. Links não contêm endereço de e-mail nem executam ações por GET; usam fragmentos e exigem uma ação explícita na página. As mensagens contêm versão textual e HTML escapado, sem imagens remotas ou rastreamento de abertura. O link de descadastro vale por um ano e desativa todas as preferências após confirmação explícita, mesmo sem login.

## APIs

- `GET /api/notifications/preferences` exige sessão e retorna `available`, `configured`, `verified`, `email`, `preferences` e `message`.
- `PUT /api/notifications/preferences` exige sessão e aceita `publications`, `reminders` e `courseId` (nulo para todos os setores).
- `POST /api/notifications/verify-request` exige sessão e consentimento prévio; responde `202` com `queued: true, sent: false` ou `503` com a indisponibilidade explícita. Há espera mínima de um minuto e limite de cinco pedidos por dia por conta.
- `POST /api/notifications/verify` recebe `{ "token": "..." }` após o clique do usuário no link de confirmação.
- `POST /api/notifications/unsubscribe` recebe `{ "token": "..." }` após a confirmação do descadastro.

As mutações herdam a política de origem do aplicativo. Nenhuma API envia e-mail na própria requisição HTTP.
