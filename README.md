# IsaBot — versão limpa com menu2 e ferramentas de grupo

Esta branch restaura o desenho do **menu2 original** e implementa funções de grupos, conversão multimídia local e busca em fontes oficiais. O processo não importa nem executa o código legado.

## O que está implementado

### Grupos

`/menu`, `/menu2`, `/ajuda`, `/admins`; `/kick`, `/add`, `/promote`, `/demote`; `/setname` (`/setsubject`), `/setdesc` (`/setdesk`); `/gp abrir|fechar`; `/modoedit abrir|fechar`; `/linkgp` (`/linkgc`); `/setftgp` (imagem respondida); `/marcar`, `/hidetag`; `/del`; `/reviver`; `/tempban` (remove e tenta readicionar após 5 min); `/bcgp` (broadcast com confirmação literal); `/public` e `/self`.

O Criador configurado pode usar as ferramentas. Alterações de grupo e marcações exigem que Criador e bot sejam administradores. O modo inicia como `self`; `/public` libera ferramentas gerais para membros, mas **não** libera comandos administrativos do grupo. `/self` volta ao modo Criador. O modo é salvo em `AUTH_DIR/bot-mode.json`.

`/bcgp` e aliases exigem `/bcgp CONFIRMAR texto`, enviam no máximo a 100 grupos e esperam 1,5 s entre envios. Use apenas com autorização dos grupos. `/tempban` usa temporizador em memória: se o serviço reiniciar nos cinco minutos, o retorno não será executado; readicionar depende dos controles do WhatsApp.

### Imagens e mídia (local)

- `/f` (aliases `/fig`, `/figu`, `/figurinha`) transforma imagem ou vídeo em figurinha WebP; o vídeo de entrada é limitado pelo tamanho e a saída recorta os primeiros 9 segundos.
- `/toimg` converte figurinha para PNG.
- `/toaud`/`/toaudio`, `/tomp3`, `/tovn`/`/toptt` convertem áudio/vídeo em áudio localmente.
- Efeitos de áudio: `/bass`, `/blown`, `/deep`, `/earrape`, `/fast`, `/fat`, `/nightcore`, `/reverse`, `/robot`, `/slow`, `/smooth`, `/tupai`.
- `/codificar` e `/decodificar` codificam/decodificam caracteres Unicode em grupos binários.
- Limite de entrada: 20 MB; conversão usa `ffmpeg` via stdin/stdout, sem gravar arquivos de mídia temporários; prazo de execução limitado.

### Pesquisa

- `/wikimedia`, `/wallpaper`, `/coffe`/`/kopi` e `/metadinha` pesquisam arquivos do Wikimedia Commons. A resposta inclui autor, licença e página-fonte quando os metadados existem. As licenças variam por arquivo; confira a página de origem.
- `/google` e `/gimagem` usam **Brave Search API** oficial, quando `BRAVE_API_KEY` estiver configurada. Busca segura estrita, no máximo 5 resultados e limite local padrão de 900 chamadas/mês. A página oficial apresenta US$ 5 por 1.000 pesquisas e US$ 5 em créditos mensais, sujeitos aos termos atuais e ao estado da conta.
- `/yts`, `/ytsearch`, `/play`, `/ytplay` usam a YouTube Data API v3 quando `YOUTUBE_API_KEY` estiver configurada, com saída apenas de links para assistir no YouTube; limite local padrão de 30 chamadas/dia. O uso de `search.list` tem cota própria; confira a cota real do projeto Google.
- `/pinterest` usa apenas o endpoint oficial OAuth `/v5/search/partner/pins`. Está condicionado a token e aprovação beta da Pinterest; sem isso, responde explicando a dependência. Não há scraping.

## Itens anunciados no menu antigo, mas não ativos

O menu identifica as funções bloqueadas e o motivo:

- `/infomsg` e `/onlines`: não expõem recibos de leitura nem presença dos membros.
- `/clonn`: desativado; cria grupos/mensagens em massa.
- `/tourl`: desativado até haver serviço oficial de upload, limites e opt-in; publicar uma imagem externamente pode tornar a mídia acessível a terceiros.
- `/semfundo` (remove.bg): desativado; exige envio da imagem a terceiro e mudança de provedor. A própria remove.bg anunciou encerramento do serviço standalone em **01/12/2026**, com migração para Leonardo.Ai; a integração nova ainda precisa ser escolhida/testada.
- `/setftbot`: altera foto global da conta, não a foto do grupo; não implementado neste worker.
- `/public` e `/self` alternam os comandos gerais, mas não há modo que permita a qualquer membro executar moderação.
- `/ytmp3`, `/ytmp4`, `/getmusic`, `/getvideo`: desativados; o bot não baixa nem republica conteúdo audiovisual do YouTube.
- `/anime`, `/waifu`, `/husbu`, `/neko`, `/shinobu`, `/megumin`, `/quotesanime`: removidos do caminho legado, que dependia de um agregador/chave antiga sem contrato verificável neste ambiente. Podem ser reimplementados quando houver API oficial licenciada escolhida.
- Google Custom Search JSON não é usado: cadastro para novos clientes foi encerrado e o encerramento do serviço está anunciado para 2027-01-01. A busca geral ativa usa Brave.
- A API Tenor foi descontinuada em 30/06/2026; não serve para novas integrações.

## Segurança de API e credenciais

Nunca publique `.env`, tokens OAuth, chaves `BRAVE_API_KEY`/`YOUTUBE_API_KEY`/`PINTEREST_ACCESS_TOKEN` nem `AUTH_DIR/`. Credenciais antigas presentes no repositório legado devem ser tratadas como comprometidas e revogadas. Use chaves próprias, com restrições de API e limites de uso na conta do fornecedor.

A imagem da busca Commons é entregue como miniatura; buscas Brave/Pinterest também buscam uma miniatura fornecida pelo proxy/origem indicada. Comandos de remoção de fundo/upload externo estão desligados por padrão, pois enviariam mídia de um participante a um terceiro. Não configure esses serviços sem avisar usuários e definir limites.

## Instalação local

Requer Node.js 20+ e FFmpeg com suporte WebP/Opus/MP3.

```sh
npm ci
cp .env.example .env
# Preencha OWNER_NUMBER e WHATSAPP_PHONE; adicione chaves somente se necessárias
npm test
npm start
```

## Railway

- Worker persistente, um único replica, sem porta HTTP.
- Volume montado em `/app/auth_info_baileys`; `AUTH_DIR=/app/auth_info_baileys`.
- Configure `OWNER_NUMBER`, `WHATSAPP_PHONE`, chaves opcionais de APIs e variáveis de cota no painel privado.
- O `railpack.json` instala ffmpeg na imagem de runtime.
- O pareamento aparece uma vez nos logs, apenas se não houver sessão registrada. Não compartilhe logs integrais.
- Railway cobra pelo uso. Confira os limites/custos vigentes em https://railway.com/pricing.

## Avisos

Baileys é uma integração comunitária não oficial com o WhatsApp Web; pode deixar de funcionar ou levar a restrições da conta. A automação não contorna limites, anti-spam nem controles do WhatsApp. Mantenha somente um worker ativo usando o mesmo volume de sessão.

## Referências oficiais

- [Wikimedia Commons API](https://commons.wikimedia.org/wiki/Commons:API)
- [Wikimedia API etiquette](https://www.mediawiki.org/wiki/API:Etiquette)
- [Brave Search API: auth](https://api-dashboard.search.brave.com/documentation/guides/authentication), [pricing](https://api-dashboard.search.brave.com/documentation/pricing)
- [YouTube Data API search.list](https://developers.google.com/youtube/v3/docs/search/list), [policies](https://developers.google.com/youtube/terms/developer-policies)
- [Pinterest Search Partner Pins](https://developers.pinterest.com/docs/api/v5/search_partner_pins/)
- [Railpack Apt packages](https://railpack.com/guides/installing-packages/)
- [remove.bg migration announcement](https://leonardo.ai/news/removebg-api-leonardo)
- [Tenor sunset notice](https://support.google.com/tenor/answer/10455265?hl=en)
