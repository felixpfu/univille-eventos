# Publicação no flxpfu.com.br

O destino autorizado é a **raiz de https://flxpfu.com.br/**. Em 23/10/2026, o responsável autorizou que as alterações solicitadas neste projeto sejam versionadas no [repositório público](https://github.com/felixpfu/univille-eventos) e publicadas neste domínio após verificação, sem pedir novamente aprovação para esse fluxo já autorizado. O build usa `/`, a API fica em `/api` e o processo escuta somente em `127.0.0.1:3002`. O Nginx mantém HTTPS e encaminha as requisições à aplicação.

O site STENDEC anterior continua armazenado em `/var/www/flxpfu.com.br/current`, sem alterações em seus arquivos ou no symlink. A configuração original do Nginx é copiada antes da troca, permitindo restaurá-lo. O repositório público contém somente código e exemplos de configuração; banco, sessões, senhas e configuração SMTP permanecem fora dele.

## Estrutura no servidor

| Caminho                                           | Uso                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `/opt/univille-node/releases/v24.22.1`            | Runtime Node exclusivo                                               |
| `/opt/univille-node/current`                      | Symlink para o runtime utilizado                                     |
| `/opt/univille-eventos/releases/RELEASE_ID`       | Código e dependências de cada versão                                 |
| `/opt/univille-eventos/current`                   | Versão ativa                                                         |
| `/var/lib/univille-eventos/events.sqlite`         | Banco persistente, incluindo sessões                                 |
| `/etc/univille-eventos.env`                       | Configuração de produção, `root:root`, modo `0600`                   |
| `/etc/systemd/system/univille-eventos.service`    | Serviço executado pelo usuário `univille-eventos`                    |
| `/var/backups/univille-eventos/deploy-RELEASE_ID` | Snapshot de dados, configuração Nginx e referência à versão anterior |

O ambiente registrado na implantação inicial possui Ubuntu 24.04, Python 3.12, Nginx e acesso pelo alias SSH `aws`. Confirme as condições do servidor antes de atualizar. Não é necessário abrir a porta 3002 no firewall. O Node do sistema e outros processos permanecem independentes.

## Runtime

Execute uma vez no servidor, usando o instalador deste repositório:

```bash
sudo bash deploy/install-node.sh 24.22.1
```

O script baixa o tarball Linux do domínio oficial `nodejs.org`, verifica seu SHA-256 contra `SHASUMS256.txt` e instala em `/opt/univille-node`. Ele não altera `/usr/bin/node`, `/usr/bin/npm` nem o `PATH` global. A versão 24.22.1 foi confirmada no índice oficial da linha 24 LTS em 23/10/2026. Para atualizar o runtime, escolha uma versão exata suportada da linha 24, teste localmente e execute o script com essa versão. O processo existente continua com seu runtime até ser reiniciado.

Referências oficiais: [releases Node](https://nodejs.org/en/about/previous-releases), [checksums da versão](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt), [API SQLite do Node 24](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).

## Preparar uma versão localmente

Use Node 24. O pacote é compilado no computador de desenvolvimento, reduzindo uso de memória do servidor.

```bash
bash deploy/package-release.sh ../univille-eventos-release.tar.gz
```

Antes de empacotar, revise o diff, execute a auditoria de produção, faça commit das alterações solicitadas e envie o commit ao GitHub. Use o commit/release no registro da publicação para identificar o código efetivamente implantado. Não inclua dados locais ou segredos.

Esse comando instala dependências pelo lockfile, executa os testes e compila o React com base `/`. O tarball inclui uma lista explícita de diretórios e exclui `.env`, banco e `node_modules`. Não copie um banco de desenvolvimento para produção.

Envie o tarball e os scripts de implantação a um diretório temporário no servidor. Um exemplo, a partir da raiz do repositório:

```bash
ssh aws 'mkdir -p /tmp/univille-upload'
scp ../univille-eventos-release.tar.gz aws:/tmp/univille-upload/release.tar.gz
scp -r deploy aws:/tmp/univille-upload/
```

## Instalar e verificar o serviço

Use um identificador único, como `20261023-001`. O instalador recusa reutilizar um identificador existente.

```bash
ssh aws 'sudo bash /tmp/univille-upload/deploy/install-release.sh /tmp/univille-upload/release.tar.gz 20261023-001'
```

Sem `--publish`, o Nginx permanece como está. O instalador cria o usuário dedicado e, na primeira execução, o arquivo de ambiente sem credenciais administrativas; extrai o pacote sem root; instala somente dependências de produção com `npm ci --omit=dev --ignore-scripts`; inicia o serviço e testa `/api/health` e `/` diretamente em localhost. Não há build no servidor.

```bash
ssh aws 'sudo systemctl status univille-eventos --no-pager'
ssh aws 'curl -fsS http://127.0.0.1:3002/api/health'
ssh aws 'sudo journalctl -u univille-eventos -n 80 --no-pager'
```

A configuração inicial usa:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3002
BASE_PATH=
DATA_DIR=/var/lib/univille-eventos
PUBLIC_ORIGIN=https://flxpfu.com.br
NODE_OPTIONS=--max-old-space-size=192
```

O backend confia em cabeçalhos de proxy somente quando a conexão vem de loopback, onde está o Nginx. Edite informações sensíveis diretamente no servidor com `sudoedit /etc/univille-eventos.env`. Não inclua credenciais em comandos, argumentos, screenshots ou commits. O arquivo permanece `0600`, e o systemd carrega as variáveis antes de reduzir privilégios. Reinicie `univille-eventos` depois de editar seu ambiente. O worker é um serviço separado e lê o mesmo arquivo a cada execução; mantenha seu timer desativado enquanto não houver SMTP configurado e validado.

## Trocar a página principal

Revise primeiro a alteração proposta, sem modificar o Nginx:

```bash
ssh aws 'python3 /tmp/univille-upload/deploy/configure-nginx.py render --output /tmp/univille-nginx-proposed.conf'
ssh aws 'diff -u /etc/nginx/sites-enabled/default /tmp/univille-nginx-proposed.conf || test "$?" -eq 1'
```

Depois de verificar o serviço e provisionar o administrador, publique a versão já ativa:

```bash
ssh aws 'sudo python3 /tmp/univille-upload/deploy/configure-nginx.py apply'
ssh aws 'curl -fsS https://flxpfu.com.br/api/health'
ssh aws 'curl -I https://flxpfu.com.br/'
```

O helper localiza o único vhost HTTPS de `flxpfu.com.br`, substitui somente o `location /` por um bloco com `location ^~ /`, preserva as diretivas SSL e mantém um caminho dedicado para desafios ACME. O `^~` evita que os regex de CSS/JS do site anterior capturem os assets do React. Ele grava backup, testa `nginx -t` antes de recarregar e restaura a configuração anterior se o teste ou reload falhar. Marcadores identificam o trecho gerenciado; reaplicar produz o mesmo resultado. Configurações inesperadas causam interrupção para revisão, sem substituição ampla do arquivo.

Para atualizações posteriores, depois de testar a nova versão localmente, o instalador também aceita `--publish`:

```bash
ssh aws 'sudo bash /tmp/univille-upload/deploy/install-release.sh /tmp/univille-upload/release.tar.gz 20261024-001 --publish'
```

Nesse modo, ele também aplica o Nginx e verifica `/api/health` e `/` pelo HTTPS local com o hostname e o certificado reais. Se a publicação falhar após a troca, tenta restaurar o symlink, o serviço e a configuração anterior. Nenhum script remove releases antigos, o banco ou o site STENDEC.

## Administração e e-mail

Administradores são provisionados somente pela CLI no servidor. Use um endereço administrativo definido fora do repositório, como `admin@example.test` no ambiente de teste; a senha deve entrar pelo stdin conforme a CLI, sem constar no repositório ou em argumentos de processo. A interface pública não possui opção de criar administrador. Para criar a conta com prompt protegido, sem mostrar a senha:

```bash
ssh -t aws 'sudo -u univille-eventos env DATA_DIR=/var/lib/univille-eventos /opt/univille-node/current/bin/node /opt/univille-eventos/current/scripts/admin.js --email admin@example.test --name Administracao'
```

A CLI também aceita a senha via stdin quando e-mail e nome são argumentos; sem esses argumentos, aceita um objeto JSON contendo `email`, `name` e `password`. A opção `--replace` redefine explicitamente uma conta existente e invalida suas sessões, devendo ser usada somente quando essa alteração for desejada.

O login identifica a conta por e-mail e senha. Confirmação da propriedade do e-mail e notificações estão implementadas, mas **nenhum provedor SMTP foi definido nesta entrega**, conforme decisão do responsável. A recuperação automática de senha não está implementada e não é habilitada pelas variáveis SMTP.

As preferências exigem consentimento e confirmação do endereço da conta. A confirmação dos pedidos do solicitante acompanha a preferência de novos eventos; lembretes têm preferência separada. A interface informa a indisponibilidade sem configuração. Detalhes e variáveis em [EMAIL.md](EMAIL.md).

O instalador fornece `univille-notifications.service` e `univille-notifications.timer`, usando o mesmo usuário, runtime, `DATA_DIR` e arquivo de ambiente do serviço web. O timer só é habilitado quando `notificationConfig.available` indica configuração coerente; sem SMTP permanece desativado. Disponibilidade de configuração não comprova entrega pelo provedor. Nesta publicação, não acrescente credenciais fictícias nem habilite o envio real.

Quando um provedor for definido, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM` e, quando necessário, `SMTP_USER`/`SMTP_PASS` exclusivamente no arquivo protegido. Use remetente autorizado, HTTPS em `PUBLIC_ORIGIN` e TLS com certificado válido. Valide o provedor com uma conta de teste autorizada antes de ativar o timer:

```bash
sudo systemctl enable --now univille-notifications.timer
sudo systemctl status univille-notifications.timer --no-pager
sudo journalctl -u univille-notifications -n 50 --no-pager
```

O timer processa a fila a cada cinco minutos. `scripts/process-notifications.js` envia mensagens elegíveis quando SMTP está disponível; não o execute contra produção apenas para inspecionar a configuração. O journal limita-se a contadores agregados e códigos, sem corpo, tokens ou senhas. Nenhum e-mail é enviado por build ou testes.

## Backup e reversão

Antes de substituir uma versão, o instalador interrompe o serviço web, o timer e o worker de e-mail e copia **todo** o diretório de dados, incluindo o banco e possíveis arquivos WAL. Isso produz um snapshot consistente. O diretório de backup e os snapshots são restritos ao root. Mantenha também uma cópia cifrada fora deste servidor conforme a política do projeto; o snapshot na mesma máquina protege contra uma atualização incorreta, mas não contra perda do servidor.

Para voltar ao código anterior, consulte `previous-release.txt` no backup da atualização, confirme que o esquema de dados é compatível e troque o symlink com o serviço parado:

```bash
sudo systemctl stop univille-notifications.timer univille-notifications.service univille-eventos
sudo ln -sfn /opt/univille-eventos/releases/RELEASE_ANTERIOR /opt/univille-eventos/.current-next
sudo mv -Tf /opt/univille-eventos/.current-next /opt/univille-eventos/current
sudo systemctl start univille-eventos
curl -fsS http://127.0.0.1:3002/api/health
```

### Migração v2

Na primeira inicialização desta versão, a migração SQLite adiciona `organizer`, `audienceCourseId`, `audienceSemester`, `submittedAt`, `queueSequence` e a sequência persistente de envios, mantendo contas, eventos, catálogos e auditoria. Ela é transacional e idempotente. A fila antiga é reconstruída pelo último `request.submitted`; pendentes precisam de envio após a última rejeição. Quando não existe essa evidência histórica, usa `updatedAt` e depois `createdAt` como aproximação documentada. Os próximos envios têm ordem persistida exata.

### Migração v3

A atualização do cadastro adiciona `users.companyName` e `users.cnpj` em transação, com valores vazios para contas existentes, e eleva `PRAGMA user_version` para `3`. Não substitui registros, hashes de senha, sessões, pedidos, catálogos, auditoria ou preferências. A execução repetida preserva os dados já preenchidos. Contas legadas seguem autenticando sem empresa/CNPJ; novos solicitantes e alterações de perfil para solicitante exigem ambos. O backup consistente anterior à atualização continua obrigatório. A aceitação pós-publicação deve conferir a versão do esquema e a preservação de contas e eventos, sem copiar dados privados para o repositório ou logs.

Não há carga de eventos de exemplo ou substituição da base. Realização de registros antigos fica vazia até o preenchimento; o PPTX usa “—” quando ausente. A criação e o reenvio passam a exigir o campo. O esquema de notificações adiciona tabelas próprias sem apagar dados existentes.

A reversão automática não restaura o banco, para não apagar solicitações criadas após a atualização. Uma restauração de dados exige avaliação do snapshot e das gravações posteriores, com serviço web, timer e worker parados. Antes de voltar a uma release anterior à migração v2, confirme sua compatibilidade com o esquema atual e com a regra de prioridade; não presuma que todo código antigo aplica as regras novas. Após restaurar o código, reative o timer somente se o SMTP estiver configurado e validado.

Para devolver a página principal ao site anterior, restaure o **backup da primeira troca da raiz**, e não o de uma atualização posterior que já contenha o proxy:

```bash
sudo python3 deploy/configure-nginx.py restore --backup /var/backups/univille-eventos/nginx-BACKUP_DA_PRIMEIRA_TROCA.conf
curl -I https://flxpfu.com.br/
sudo systemctl disable --now univille-notifications.timer
sudo systemctl stop univille-notifications.service
sudo systemctl disable --now univille-eventos
```

O helper também testa a configuração de restauração antes de recarregar o Nginx. O site anterior usa seus arquivos originais, preservados em `/var/www/flxpfu.com.br/current`. Guarde o caminho exato do primeiro backup no registro da publicação.
