# IsaBot — gerenciador restrito de grupos

Esta variante foi separada do código legado e preserva somente comandos de moderação de grupos. **Não contém** consultas de CPF, RG, CNS, telefone ou placas; execução de shell/eval; cópia/clonagem de grupos; scrapers ou APIs externas de consulta.

## Comandos

Todos os comandos funcionam em grupos e exigem que o número `OWNER_NUMBER` seja administrador do grupo. Para comandos que alteram o grupo, o próprio bot também deve ser administrador.

- `/ajuda`
- `/admins`
- `/kick @membro` ou `/kick 55DDDNUMERO`
- `/add 55DDDNUMERO`
- `/promote @membro` e `/demote @membro`
- `/setname novo nome`
- `/setdesc nova descrição`
- `/gp abrir|fechar` — controlar quem pode enviar mensagens
- `/modoedit abrir|fechar` — controlar edição das informações do grupo
- `/linkgp` — exibir o link de convite do grupo atual

## Pairing por código

O código é solicitado a partir de `WHATSAPP_PHONE` e aparece nos logs do processo como `PAIRING_CODE=...`. No telefone, abra **WhatsApp → Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone** e insira o código. Só aprove se reconhecer o ambiente e o dispositivo.

`OWNER_NUMBER`, `WHATSAPP_PHONE` e a pasta de autenticação são segredos/operações privadas. Configure as variáveis no painel Railway ou num `.env` local e **nunca commite `.env` nem `auth_info_baileys/`**. A pasta `AUTH_DIR` precisa estar em volume persistente; sem isso, reinicializações podem perder a sessão. As credenciais da pasta permitem controlar a conta vinculada.

## Execução local

Requer Node.js 20 ou superior:

```bash
npm install
cp .env.example .env
# Edite OWNER_NUMBER e WHATSAPP_PHONE em .env
npm test
npm start
```

## Railway

Use um serviço worker/background. Defina `OWNER_NUMBER` e `WHATSAPP_PHONE` como variáveis privadas; monte um volume persistente em `/app/auth_info_baileys`; `AUTH_DIR` já aponta para esse caminho. O código de pareamento aparecerá uma vez nos logs iniciais, somente quando não houver sessão registrada.

**Custos:** Railway é cobrado por uso. A página oficial informa plano Hobby de US$ 5/mês com US$ 5 de uso incluído, sujeito a cobrança de uso excedente; confira a sua conta e limites antes de deixar o serviço ligado: https://railway.com/pricing.

## Avisos

Baileys é uma integração comunitária não oficial com o WhatsApp Web; pode parar de funcionar ou levar a restrições da conta. Leia os termos e as regras do WhatsApp antes de conectar. Esta cópia não contorna limites, anti-spam nem controles da plataforma.
