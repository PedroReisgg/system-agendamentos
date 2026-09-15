# Publicação gratuita — Netlify + Supabase

## 1. Preparar o banco no Supabase

No **SQL Editor**, crie uma consulta nova, cole o conteúdo de cada arquivo abaixo e clique em **Run**, nesta ordem:

1. `database/supabase.booking.fix.sql` — corrige o bloqueio de antecedência dos horários de hoje.
2. `database/supabase.public-professionals.sql` — permite exibir os nomes dos profissionais na reserva.
3. `database/supabase.seed.sql` — adiciona serviços, profissionais e horários iniciais.

Os três arquivos que já foram executados (`schema.supabase.sql`, `supabase.auth.sql` e `supabase.booking.sql`) não devem ser executados outra vez.

## 2. Configurar o e-mail de confirmação

No Supabase, abra **Authentication → URL Configuration**.

Para teste local, defina:

```text
Site URL: http://localhost:5173
Redirect URLs: http://localhost:5173/**
```

Depois que o site estiver no Netlify, substitua o Site URL pela URL final e mantenha ambas as URLs em Redirect URLs:

```text
http://localhost:5173/**
https://SEU-SITE.netlify.app/**
```

Em **Authentication → Providers → Email**, deixe o provedor Email ativo. Para produção, configure SMTP próprio em **Authentication → SMTP Settings**; o servidor de e-mail padrão do Supabase serve para teste e possui limites.

## 3. Testar localmente

No PowerShell, dentro da raiz do projeto:

```powershell
npm install
npm run dev --workspace frontend
```

Abra `http://localhost:5173`. Cadastre uma conta, confirme o e-mail e faça login. Em seguida, abra **Agendar horário** e teste os quatro passos.

Nunca envie `frontend/.env` ao GitHub. Ele contém a configuração do seu projeto Supabase.

## 4. Enviar o projeto ao GitHub

Crie um repositório vazio no GitHub. Depois execute na raiz do projeto (substitua a URL):

```powershell
git add .
git commit -m "Publicar agenda Casa Ambar"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

Se o Git pedir nome/e-mail antes do commit:

```powershell
git config --global user.name "Seu Nome"
git config --global user.email "seu-email@exemplo.com"
```

## 5. Publicar no Netlify

1. Acesse `https://app.netlify.com` e faça login com GitHub.
2. Clique em **Add new project → Import an existing project**.
3. Escolha GitHub e selecione o repositório.
4. O arquivo `netlify.toml` já preenche as opções corretas:
   - Build command: `npm run build --workspace frontend`
   - Publish directory: `frontend/dist`
5. Antes de clicar em Deploy, abra **Environment variables** e adicione:

```text
VITE_SUPABASE_URL = a URL do seu projeto Supabase
VITE_SUPABASE_PUBLISHABLE_KEY = a chave Publishable do Supabase
SUPABASE_URL = a URL base do seu projeto Supabase
SUPABASE_SERVICE_ROLE_KEY = a chave Secret / service_role do Supabase
```

6. Clique em **Deploy site**.
7. Copie a URL `.netlify.app` criada e volte ao passo 2 para adicioná-la no Supabase.
8. Faça um novo deploy no Netlify após salvar as variáveis/URLs.

## Segurança

- Use somente `VITE_SUPABASE_PUBLISHABLE_KEY` no Netlify e no frontend.
- `SUPABASE_SERVICE_ROLE_KEY` é usada exclusivamente pela Function do Netlify para cadastrar funcionários. Cadastre-a somente nas variáveis privadas do Netlify.
- Nunca publique a chave `sb_secret...` / `service_role` no navegador, GitHub ou `frontend/.env`.
- O diretório `backend/` é legado do MySQL local e não é publicado neste deploy estático.
