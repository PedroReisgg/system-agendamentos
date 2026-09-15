# MySQL local — desenvolvimento

## 1. Criar banco e tabelas

Com o MySQL 8 em execução, importe o schema na raiz do projeto:

```powershell
Get-Content -Raw -Encoding utf8 .\database\schema.mysql.sql | mysql -u root -p
```

O script cria o banco `agenda_dev` e o tenant inicial `casa-ambar`.

## 2. Criar o usuário local do banco

No terminal MySQL, execute:

```sql
CREATE USER IF NOT EXISTS 'agenda_user'@'localhost' IDENTIFIED BY 'agenda_dev_password';
GRANT ALL PRIVILEGES ON agenda_dev.* TO 'agenda_user'@'localhost';
FLUSH PRIVILEGES;
```

Se o MySQL estiver em outro host, ajuste `DB_HOST`, `DB_USER` e `DB_PASSWORD` em `backend/.env`.

## 3. Configurar e iniciar

O arquivo `backend/.env` já contém valores locais. Troque `JWT_SECRET` antes de disponibilizar a aplicação. Para teste local sem SMTP, o cadastro é salvo, mas a verificação de e-mail não será enviada até as variáveis SMTP serem preenchidas.

```powershell
npm run dev:api
npm run dev
```

Frontend: `http://localhost:5173/?tenant=casa-ambar`.

## 4. Criar o primeiro administrador

Cadastre primeiro uma conta comum pela tela e confirme o e-mail. Depois, no MySQL, promova-a:

```sql
UPDATE users
SET role = 'admin', email_verified_at = NOW()
WHERE email = 'seu-email@exemplo.com';
```

Crie profissionais, serviços, vínculos em `professional_services` e os períodos em `working_hours` antes de aceitar reservas. O campo `day_of_week` usa `0` para domingo e `6` para sábado.

## Deploy

Netlify deve hospedar apenas o frontend. Configure `VITE_API_URL` com a URL HTTPS da API. Hospede a API Node/MySQL em um servidor com suporte a processos persistentes (por exemplo, Hostinger VPS com PM2); Netlify não executa este servidor Express continuamente.
