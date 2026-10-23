# Validação

Registro técnico da entrega de **23/10/2026**. Use este documento junto do caderno de [requisitos](REQUISITOS.md). Os testes criam bancos temporários e dados fictícios próprios; não dependem de contas ou eventos do ambiente publicado.

## Verificações automatizadas

Comandos reproduzíveis na raiz do projeto, após `npm ci`:

```bash
npm test
npm run build
npm audit --omit=dev
```

Resultado registrado: **8 testes de integração aprovados**, sem vulnerabilidades de produção reportadas pela auditoria executada nesta entrega. O resultado da auditoria descreve a base conhecida naquela execução e deve ser reavaliado ao atualizar dependências.

| Teste                  | Evidências cobertas                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autenticação e perfis  | Hash de senha, sessão por token, bloqueio de autocadastro administrativo, permissões de visitante, origem indevida e desativação de conta                                           |
| Jornada do solicitante | Propriedade do registro, rascunho incompleto, envio, rejeição com motivo, correção/reenvio, cancelamento e exclusão restrita                                                        |
| Agenda e concorrência  | Datas/horários inválidos, recurso de outro ambiente, sobreposição no envio e na edição, intervalos adjacentes, ambientes diferentes e aprovações simultâneas com somente um sucesso |
| Cadastros e relatórios | Integridade dos vínculos, filtros combinados, campos da tabela/CSV e tratamento de conteúdo de planilha                                                                             |
| Janela pública e senha | Limites mensais no fuso de São Paulo e invalidação de sessões anteriores ao trocar senha                                                                                            |
| Produção e origem      | Cookies seguros, restrição CSRF por origem e funcionamento com prefixo configurável                                                                                                 |
| Persistência           | Banco inicia vazio e preserva contas/catálogos entre reinicializações                                                                                                               |
| Escritas protegidas    | Propriedade, permissões de visitante e expiração de sessão                                                                                                                          |

A suíte usa o servidor HTTP real e SQLite; não substitui as regras por mocks. O CI executa instalação, testes e build em pushes e pull requests com Node 24. Ele não implanta em produção e não precisa de segredos de servidor.

## Verificação manual da interface

Na execução desta entrega, foram conferidos pelo navegador: manutenção dos cadastros administrativos; envio inválido seguido de correção sem duplicar o pedido; envio como pendente; aprovação administrativa; publicação na agenda; relatórios; e modo escuro. Não há suíte automatizada de navegador armazenada no projeto.

## Implantação

Também foram verificados:

- Sintaxe Bash e Python dos scripts de implantação.
- Substituição exata do bloco raiz do Nginx, reaplicação idempotente e recusa de configurações ambíguas ou marcadores incompletos.
- Configuração proposta validada pelo próprio Nginx no servidor, usando arquivo temporário separado do ativo.
- Unidade de serviço validada com `systemd-analyze verify`.
- Node 24.22.1 exclusivo instalado por tarball oficial com SHA-256 conferido; Node global preservado.

O instalador testa `/api/health` e `/` em localhost antes de publicar. Com `--publish`, verifica novamente ambos pelo HTTPS e hostname reais. Backups, rollback e arquivos persistentes são descritos em [DEPLOYMENT.md](DEPLOYMENT.md). A publicação exige confirmar os resultados da versão efetivamente implantada; a validação isolada da configuração não significa que a troca do domínio já ocorreu.

## Roteiro de aceite pela interface

Execute com dados fictícios, cobrindo visitante, solicitante e administrador em sessões separadas. Este roteiro indica o aceite a repetir após mudanças; não declara que cada cenário teve teste visual automatizado.

1. Abra a agenda sem login. Confirme somente aprovados dos três meses permitidos, ordenação, busca/filtros e ausência de informações internas.
2. Crie cadastros administrativos: centro, recurso, ambiente com recurso, curso com centro e tema. Confirme bloqueios ao excluir um cadastro referenciado.
3. Cadastre solicitante e visitante. Confirme que visitante não solicita e que solicitante não acessa administração nem solicitações de outro autor.
4. Salve um rascunho incompleto, reabra e complete todos os campos. Verifique o centro automático, recursos do ambiente e respostas Sim/Não.
5. Envie o pedido. Rejeite com motivo em outra sessão; confirme o motivo para o autor, corrija e reenvie. Aprove e confira publicação automática.
6. Tente sobrepor outro pedido no mesmo ambiente. Confirme bloqueio e aceitação de horários adjacentes ou outro ambiente. Confirme que solicitante não altera aprovado.
7. Edite e cancele um aprovado como administrador. Confirme sua remoção pública e manutenção do registro. Cancele um pendente próprio e exclua um rascunho próprio.
8. Combine filtros de período, curso e tema no relatório. Compare registros e colunas do CSV com a tabela.
9. Altere a própria senha, saia e entre novamente. Desative uma conta e confirme a perda de acesso. Verifique que o último administrador ativo não pode ser removido.
10. Repita navegação, formulários e diálogos em computador e celular; confira foco por teclado, rótulos, rolagem, modos claro/escuro e mensagens de validação.

## Limites

Os testes não constituem auditoria independente de segurança, avaliação de carga ou certificação de acessibilidade. Não foram alegadas entrega SMTP, autenticação institucional, recuperação automática por e-mail ou emissão de certificados. O ambiente público inicia sem dados de demonstração; a equipe precisa cadastrar os catálogos para solicitar o primeiro evento.
