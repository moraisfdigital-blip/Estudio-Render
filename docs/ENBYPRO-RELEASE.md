# ENBY PRO — entrega e publicação

Atualizado em 04/10/2026. **Implementação local testada; produção ainda não publicada.**

**Trabalho pausado pelo usuário em 04/10/2026.** Para retomar, ler primeiro [RETOMAR-ENBYPRO.md](RETOMAR-ENBYPRO.md), que registra a confirmação da VPS do cliente, o DNS mais recente e as tentativas de liberação do terminal.

## Código e escopo

- Repositório: `moraisfdigital-blip/estudio-render`.
- Branch: `codex/enbypro-release`, criada a partir de `bf15b4d`.
- Implementação: commit `4873a70`; [PR #18](https://github.com/moraisfdigital-blip/Estudio-Render/pull/18), aberto em rascunho e sem conflitos ao verificar.
- Worktree: `D:\SET UP NOVO\orca\workspaces\estudio-render\enbypro-release`.
- O usuário autorizou worktree Git sem Orca, implementação, testes, deploy na única VPS da Hostinger e domínio `enbypro.com`. Não é necessário pedir novamente autorização para essas etapas.
- Checkout original preservado. Sem merge em main.
- Nenhum ticket Linear foi vinculado à sessão e não havia ferramenta Linear/Orca operacional. Checkpoints estão neste arquivo e no PR; sincronização com o ticket permanece pendente.

## Implementação

- Frontend visual existente conectado ao salvamento de estudos por projeto. Revisão atômica impede sobrescrever alterações de outra sessão; conflito retorna 409.
- Composição, superfícies, foto ativa, iluminação e opacidade persistidos. O estudo visual não confirma medidas de fabricação nem sobrescreve os registros de levantamento.
- Atalhos para máscaras/proteção, geração, versões/aprovação e apresentação/PDF/orçamento.
- OpenRouter por adapter selecionável via `IMAGE_GEN_PROVIDER=openrouter`, chave apenas no servidor. Fotos reencodadas sem EXIF; máscara enviada junto. Architecture Lock aplicado localmente ao resultado.
- A interface informa quando a geração é simulação local e quando a fotografia será enviada ao OpenRouter. Sem chave, o botão fica indisponível.
- Respostas limitadas em tamanho/resolução, sem seguir redirecionamentos ou buscar URLs retornadas pelo provedor. Erros sanitizados e sem repetição automática de chamadas pagas.
- Limite atômico de tentativas pagas por tenant/hora, configurável por `GENERATION_LIMIT_PER_HOUR` (20 por padrão). Tentativas com falha também consomem a reserva; não é limite monetário.
- Registro público fechado por padrão; link de cadastro acompanha a configuração. PyJWT atualizado para 2.15.0 após auditoria.
- Compose com porta apenas em loopback, Mongo sem porta pública, volumes persistentes, processo não root e restrições de container existentes preservadas. Dados QA e arquivos de ambiente excluídos do build.

## Verificação realizada

Ambiente Windows, Python 3.14, MongoDB local real e banco temporário exclusivo por execução. Nenhum banco de produção utilizado.

| Verificação | Resultado |
| --- | --- |
| Suíte backend completa | 304 testes passaram; nenhum skip/falha reportado |
| `npm run build` | passou |
| `npm run lint` | passou sem avisos |
| `npm audit --json` | zero vulnerabilidades conhecidas, incluindo dev |
| `python -m pip_audit -r requirements.txt` | nenhuma vulnerabilidade conhecida |
| `python -m bandit -r app -q` | passou sem achados; apenas dois rótulos de evento falsamente detectados como senha têm supressão B105 justificada |
| `git diff --check` | passou; Git informou apenas conversão de finais de linha Windows |

Cobertura inclui autenticação, isolamento entre tenants, uploads, preservação do original, máscaras, calibração, propostas, aprovação, PDF, orçamento e controles de segurança já existentes. Novos testes verificam estudos persistidos, conflito de revisão, referências entre projetos/tenants, cores e coordenadas inválidas, respostas inseguras do provedor e concorrência do limite de geração.

O GitHub ainda reportou 26 alertas abertos de PyJWT nos manifests de produção/desenvolvimento da branch padrão. Os alertas com correção indicam 2.14.0/2.15.0; o alerta sem versão corrigida informada (`GHSA-gvp8-978c-rx2q`) declara faixa afetada até 2.13.0. Esta entrega usa 2.15.0 e passou no pip-audit. Os alertas da main não foram encerrados manualmente; a branch padrão continua sem merge.

No Chrome, usando somente dados sintéticos locais:

1. Login, criação de cliente/local/projeto e upload de fachada PNG.
2. Calibração com referência de 8 m e salvamento da medida.
3. Edição de texto para `ENBY QA SALVO`, salvamento e recarga da página; texto e medida preservados.
4. Máscara de intervenção com quatro vértices salva.
5. Proposta mock gerada, promovida a versão e aprovada.
6. Apresentação salva e PDF gerado: duas páginas, aproximadamente 114 KB.
7. Conferência DOM do editor e apresentação em largura efetiva de 468 CSS px: sem transbordamento horizontal da página. Janela restaurada ao terminar.

Limites: captura de screenshot falhou por timeout do controle do navegador; não houve revisão visual final por imagem nem teste em aparelho móvel físico. OpenRouter foi validado com transporte simulado, sem chamada real porque a chave não estava configurada. Docker não está instalado no ambiente local: build de container, Linux/Python 3.12, restauração de backup e verificações públicas continuam pendentes. Auditorias sem achados não equivalem a certificação de ausência de vulnerabilidades.

## Destino confirmado e bloqueios

- Única VPS vista no painel Hostinger: `srv1951666.hstgr.cloud`, Ubuntu 24.04, KVM 2, IPv4 `179.199.141.95`.
- DNS A observado de `enbypro.com`: `2.57.91.91`. Não alterado.
- Console `https://cam.hostingervps.com/3503/` bloqueado pelo controle de navegador por preferência salva do usuário, inclusive após reafirmação da autorização. Não contornar por outro navegador, protocolo ou execução indireta.
- SSH em modo não interativo recusou a autenticação. Nenhuma credencial alternativa disponível.
- `OPENROUTER_API_KEY` não configurada nos ambientes locais inspecionados. Não pedir senha/chave pelo chat; configurar diretamente no ambiente protegido da VPS.
- Nenhuma alteração de DNS, certificado, firewall, serviço ou dado foi aplicada na VPS.

## Procedimento para retomar a publicação

Após liberar o acesso ao console ou disponibilizar acesso SSH autorizado, executar a sequência abaixo. A autorização do usuário já existe; o bloqueio é técnico de acesso.

1. Inspecionar hostname/IP, serviços, proxy, containers, portas e volumes atuais. Preservar outros sites e obter backup/snapshot antes de qualquer substituição. Confirmar que 8010 está livre.
2. Usar um diretório novo `/opt/enbypro/releases/<commit>` com este commit e um arquivo protegido `/opt/enbypro/shared/.env` (permissões 600), baseado em `deploy/production.env.example`. Não copiar `.env` de QA, Mongo de teste ou credenciais locais.
3. Configurar JWT aleatório forte, conta owner do responsável, senha forte e chave OpenRouter diretamente no servidor. `ALLOW_SELF_REGISTER=false`, `IMAGE_GEN_PROVIDER=openrouter`. Remover a senha de seed do ambiente após a primeira criação e recriar o container; isso não troca a senha já gravada.
4. Construir e iniciar com o mesmo nome de projeto Compose para preservar volumes entre releases:

```sh
docker compose --env-file /opt/enbypro/shared/.env -p enbypro config --quiet
docker compose --env-file /opt/enbypro/shared/.env -p enbypro up -d --build
docker compose --env-file /opt/enbypro/shared/.env -p enbypro ps
curl --fail http://127.0.0.1:8010/api/health
```

5. Auditar imagens construídas e verificar saúde, restrições, persistência e consumo de memória. Executar testes Linux em banco exclusivo de teste, nunca apontar pytest ao banco de produção.
6. Integrar `deploy/nginx.enbypro.conf` somente se o proxy existente for Nginx. Se já houver outro proxy, usar a rota equivalente nele sem instalar um concorrente. Validar configuração antes de reload. O modelo fornecido é HTTP inicial; HTTPS ainda precisa ser emitido e validado.
7. Apontar somente os registros web `@` e `www` para a VPS. Preservar MX/TXT e serviços de email; conferir AAAA e CAA existentes antes de emitir certificado. Verificar resolução autoritativa e pública.
8. Emitir certificado para `enbypro.com` e `www.enbypro.com`, redirecionar HTTP para HTTPS e testar renovação. Preservar acesso SSH ao configurar firewall; expor apenas portas necessárias. Mongo e porta 8010 devem permanecer inacessíveis externamente.
9. Testar login autorizado, rejeição sem token e de outro tenant, registro fechado, rate limit, uploads inválidos, headers de segurança, docs de API fechadas e ausência de exposição de `.env`/arquivos privados.
10. Fazer uma geração real OpenRouter com foto sintética e máscara, confirmar preservação pixel a pixel fora da intervenção, aprovar e exportar PDF. Verificar saldo/modelo/erros sem gravar chave em logs.
11. Testar backup e restauração isolada. Copiar o backup para armazenamento protegido fora da VPS. Só então registrar publicação concluída com commit, URL, certificado e evidências dos testes.

### Backup e reversão

`deploy/backup.sh` produz dump Mongo e arquivo de mídia com hashes; ainda não executado na VPS. É uma cópia operacional, sem transação conjunta entre banco e mídia: executar em janela sem gravações para consistência. Rodar a partir da release com `ENV_FILE=/opt/enbypro/shared/.env` e `BACKUP_ROOT` protegido fora da release. Não usar `docker compose down -v`.

Para reverter aplicação, executar Compose a partir da release anterior com o mesmo projeto `enbypro`, arquivo de ambiente e volumes. As mudanças de banco desta entrega são aditivas. Restaurar dados somente após decisão específica e em ambiente isolado primeiro; não sobrescrever gravações novas para corrigir apenas código.

## Referências da integração

- [OpenRouter Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation): endpoint `/api/v1/images`, referências de imagem e resposta inline.
- [PyJWT 2.15.0](https://pyjwt.readthedocs.io/en/2.15.0/changelog.html): atualização de segurança.
