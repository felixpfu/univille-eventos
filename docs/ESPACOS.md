# Espaços, imagens e capacidade — v1.7.0

A página **Espaços** reúne os locais cadastrados, com imagem, descrição, capacidade máxima e acesso à agenda. Os valores abaixo foram informados pelo responsável em **23/10/2026**, para o campus São Bento do Sul:

| Local         | Capacidade máxima informada | Imagem selecionada                         |
| ------------- | --------------------------- | ------------------------------------------ |
| Auditório     | 300 pessoas                 | Fotografia publicada pela Univille em 2023 |
| Miniauditório | 120 pessoas                 | Ilustração gerada por IA                   |

As capacidades não foram calculadas a partir das imagens. Espaços sem capacidade cadastrada mostram **Capacidade não informada**. A exibição não contabiliza participantes ou inscrições; esses fluxos não fazem parte do sistema.

## Agenda e solicitação por espaço

Clique na imagem, no nome ou em **Ver agenda deste espaço**. A agenda abre na visualização **Lista**, com o local fixado e identificado no cabeçalho. O seletor de local fica travado e limpar filtros mantém o espaço. As abas e setas de mês permitem consultar seus eventos aprovados futuros e passados. **Todos os espaços** retorna aos cards; **Eventos**, na navegação principal, abre novamente o calendário geral.

**Solicitar um evento**, no card, ou **Solicitar neste espaço**, na agenda, abre um novo pedido com o local preenchido. **Propor um evento**, no estado vazio dessa agenda, mantém a mesma seleção. Para uma pessoa sem sessão, o sistema pede login e mantém essa escolha quando uma conta de solicitante ou administrador entra. O local continua editável no formulário; outro pedido iniciado em **Minhas solicitações** começa sem local herdado. Contas visitantes consultam a agenda, mas não ganham permissão para criar pedidos por esse caminho.

## Administração

Em **Administração → Cadastros → Ambientes**, edite **Capacidade máxima (pessoas)** e **Imagem do espaço**, além dos campos e vínculos já existentes.

- Capacidade aceita inteiro entre 1 e 100.000; deixe em branco quando não houver informação confirmada.
- A imagem é selecionada de um catálogo local. A opção **Automática (ilustrativa)** remove a escolha explícita e usa uma ilustração de miniauditório para nomes de auditório, ou de sala para os demais ambientes.
- Fotos e ilustrações têm rótulos, texto alternativo e créditos próprios. A fonte externa, quando disponível, aparece em **Ver fonte**.
- O catálogo não recebe uploads nem URLs de imagem fornecidas pelo formulário ou pela API.

O catálogo autorizado em `server/room-media.js` contém:

| Chave                       | Tipo                     | Arquivo local                            |
| --------------------------- | ------------------------ | ---------------------------------------- |
| `auditorio-sbs`             | Fotografia institucional | `/venues/auditorio-sbs.webp`             |
| `miniauditorio-ilustrativo` | Ilustração gerada por IA | `/venues/miniauditorio-ilustrativo.webp` |
| `sala-ilustrativa`          | Ilustração gerada por IA | `/venues/sala-ilustrativa.webp`          |

A fotografia do Auditório acompanha a [notícia da Univille de 21/10/2023](https://www.univille.edu.br/noticias/2023.10/aulao-enem-univille-sao-bento-do-sul/887777), que identifica o local no campus São Bento do Sul. As outras imagens são ilustrações, sem alegação de retratar as instalações reais. A fotografia histórica e as ilustrações não comprovam configuração atual, capacidade ou equipamentos. Origem, créditos, tratamentos e direitos de cada arquivo estão em [public/venues/SOURCE.md](../public/venues/SOURCE.md).

## API e persistência

`POST /api/admin/catalog/rooms` e `PUT /api/admin/catalog/rooms/:id` exigem administração. Os campos novos são `capacity: number | null` e `imageKey: string`. Capacidade fracionária, fora da faixa, não finita ou enviada como texto é recusada. A chave deve pertencer ao catálogo ou ser vazia; `null`, URLs e chaves desconhecidas são recusados.

Omitir os campos em um PUT preserva os valores existentes. `capacity: null` limpa a capacidade; `imageKey: ""` remove a seleção explícita. Os demais campos e vínculos continuam sujeitos às regras existentes, incluindo a preservação de recursos utilizados por eventos.

`GET /api/metadata` publica, para cada espaço, somente `id`, `name`, `description`, `capacity` e `imageKey`. O campo `roomImages` lista `key`, `label`, `path`, `alt`, `kind`, `credit` e `sourceUrl`. Caminhos de imagem são locais; a URL de origem é apenas o crédito da fonte. Os metadados completos de solicitantes e administradores mantêm os vínculos de recursos.

A migração **v5** adiciona os campos de forma transacional e idempotente, com capacidade `null` e chave vazia para registros anteriores. Não altera usuários, eventos, versões, fila, auditoria, catálogos antigos ou vínculos e não configura imagens ou lotação pelo nome. Uma base nova continua vazia. Os valores de 300/120 pessoas e as respectivas imagens são configurações administrativas explícitas, posteriores à migração.
