# ENBY PRO — checkpoint de pausa

**PAUSADO a pedido do usuário em 04/10/2026, 02:51 (America/Sao_Paulo).** Não retomar implementação ou publicação até o usuário pedir continuidade. Este checkpoint apenas preserva o estado; não significa publicação concluída.

## Onde continuar

- Checkout do orquestrador: `D:\SET UP NOVO\estudio-render`. Preservado, inclusive o `debug.log` preexistente não rastreado.
- Código desta entrega: `D:\SET UP NOVO\orca\workspaces\estudio-render\enbypro-release`.
- Branch: `codex/enbypro-release`.
- Repositório: `moraisfdigital-blip/Estudio-Render`.
- [PR #18](https://github.com/moraisfdigital-blip/Estudio-Render/pull/18), aberto em rascunho, sem merge.
- Implementação em `4873a702aeac0f66c5549ba8cb16c08818d96598`; relatório anterior em `b84fbd7`.
- Relatório técnico, validações e procedimento de deploy: [ENBYPRO-RELEASE.md](ENBYPRO-RELEASE.md).

## Decisões confirmadas pelo usuário

- Finalizar frontend, integrar OpenRouter, publicar e testar, incluindo segurança.
- Domínio: `enbypro.com`.
- **Usar a VPS do cliente**, não uma VPS pessoal. O usuário esclareceu que mencionar a propriedade do cliente era apenas uma hipótese para o bloqueio, não uma troca de destino.
- VPS identificada no painel: `srv1951666.hstgr.cloud`, IPv4 `179.199.141.95`, Ubuntu 24.04, KVM 2.
- Worktree Git isolada sem Orca explicitamente autorizada.
- Não pedir repetidamente a autorização que já foi dada. Depois de solicitado o retorno, avançar dentro desse escopo; solicitar apenas informação indispensável ou tratar bloqueio real.

## Entregue e verificado antes da pausa

- Frontend existente integrado a estudos visuais persistidos e controle de revisão.
- Atalhos para máscaras, propostas, versões/aprovação e apresentação/PDF/orçamento.
- Adapter OpenRouter, sanitização de erros, limites de resposta, preservação local da arquitetura e limite de tentativas pagas por tenant/hora.
- Cadastro fechado por padrão e distinção explícita entre simulação local e IA externa.
- Configuração de Compose/proxy/backup preparada; nenhum desses arquivos foi instalado na VPS.
- **304 testes backend passaram**, build e lint passaram; npm audit, pip-audit e Bandit sem achados na branch testada.
- Fluxo Chrome com dados sintéticos: criar projeto, upload, calibrar, salvar/recarregar estudo, salvar máscara, gerar mock, promover/aprovar versão e exportar PDF de duas páginas.
- Capturas automáticas de screenshot falharam; revisão visual final por imagem e aparelho móvel físico continuam pendentes.
- Geração OpenRouter real, container Docker/Linux, backup/restauração e testes em produção continuam pendentes.

## Bloqueio atual de acesso

O terminal do cliente estava aberto em `https://cam.hostingervps.com/3503/`. O usuário seguiu o caminho Configurações > Uso do computador > Google Chrome > Gerenciar, adicionou o domínio e escolheu **Sempre permitir**. Uma captura confirmou a regra salva. O usuário também reiniciou o aplicativo.

Mesmo assim, as tentativas posteriores pelo controle oficial de navegador foram recusadas com: `A saved user permission setting blocks this action`. A causa da divergência entre a interface e o controle de acesso não foi confirmada. Não atribuir o problema ao fato de a VPS pertencer ao cliente. Não pedir que o usuário repita indefinidamente os mesmos passos.

Não contornar a recusa usando outro navegador, comandos de navegador não autorizados, CDP, execução indireta ou leitura de sessão/cookies. Ao retomar, testar o acesso apenas quando houver pedido ou mudança de estado; se continuar bloqueado, informar o resultado real. Foi sugerido relatar a divergência pelo `/feedback`, mas não há confirmação de envio.

SSH não interativo também havia recusado autenticação. Nenhuma credencial SSH alternativa foi fornecida. A chave OpenRouter não foi disponibilizada ao ambiente do projeto; havia uma aba de gerenciamento de chaves aberta, o que não comprova configuração. Não incluir senhas, chaves ou `.env` real no Git, no chat ou nos relatórios.

## Domínio e produção

DNS conferido novamente imediatamente antes da pausa:

| Nome | Registro observado |
| --- | --- |
| `enbypro.com` | A `2.57.91.91` |
| `www.enbypro.com` | CNAME `enbypro.com` |
| VPS de destino | IPv4 `179.199.141.95` |

**Domínio ainda não aponta para a VPS de destino.** Nenhuma mudança foi feita em DNS, TLS, firewall, proxy, serviços, dados ou sistema operacional da VPS. O aplicativo não foi publicado.

## Próximo passo quando o usuário retomar

1. Ler este checkpoint e o relatório técnico; confirmar branch/HEAD e eventuais mudanças locais antes de editar.
2. Revalidar acesso autorizado à VPS do cliente, preservando os serviços existentes. Não substituir outras aplicações nem restaurar dumps sobre dados atuais.
3. Quando houver acesso, inspecionar o servidor e preparar release isolada, backup e configuração protegida. Configurar OpenRouter sem transmitir a chave pelo chat.
4. Executar build e validações Linux, testar aplicação em loopback e uma geração real com fotografia sintética.
5. Somente com aplicação pronta, apontar registros web do domínio, emitir HTTPS e validar externamente. Preservar email e outros registros DNS.
6. Concluir testes públicos de segurança, persistência, PDF e restauração isolada antes de declarar a entrega completa.

Não há ticket Linear vinculado à sessão; o histórico está no PR e nos arquivos acima. Sincronizar com o ticket apenas se for identificado no escopo Estudio Render/FRA.

## Ambiente local preservado

Os arquivos locais ignorados, ambiente virtual, configuração QA e dados sintéticos foram mantidos na worktree; não foram enviados ao GitHub. O preview usava `http://127.0.0.1:8011`, banco `enbypro_release_qa` e provider mock. Na checagem da pausa não foi identificado listener local na porta 8011; não presumir que o preview continua ativo. Nenhum serviço foi iniciado para este checkpoint.
