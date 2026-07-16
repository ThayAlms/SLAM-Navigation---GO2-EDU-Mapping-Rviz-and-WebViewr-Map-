# Banco Supabase

A migração em `migrations/202607150001_initial_schema.sql` cria:

- perfis vinculados ao Supabase Auth;
- histórico de logins;
- status/telemetria do robô;
- fila de comandos para o bridge da Jetson;
- fila de análises da Oracle;
- índices, triggers, RLS e publicação Realtime.

A migração `202607150002_sync_auth_profiles.sql` repara e mantém a sincronização entre usuários do Auth e a tabela pública de perfis.

A migração `202607160003_go2_control_commands.sql` adiciona os comandos de
rotação, postura, velocidade e mapa usados pelo painel integrado do Go2.

O arquivo `admin_queries.sql` reúne somente consultas de leitura para usuários, logins, status, comandos e análises. Ele não é uma migração e não deve ser executado como parte da criação do banco.

## Aplicação pelo Dashboard

1. Abra **SQL Editor** no projeto Supabase.
2. Crie uma nova consulta.
3. Cole e execute `202607150001_initial_schema.sql`.
4. Em uma nova consulta, cole e execute `202607150002_sync_auth_profiles.sql`.
5. Em uma nova consulta, cole e execute `202607160003_go2_control_commands.sql`.
6. Em **Authentication > Providers > Email**, habilite cadastro por e-mail e desative **Confirm email** para permitir cadastro com entrada imediata em um ambiente de teste.
7. Crie a primeira conta pelo próprio frontend.
8. Se esse usuário administrar logs, execute somente uma vez, trocando o e-mail:

   ```sql
   update public.profiles
   set role = 'admin'
   where email = 'email@empresa.com';
   ```

9. Copie a Project URL e a publishable key para o frontend e backend.
10. Copie a secret/service role key somente para o backend.

As migrações são idempotentes, mas devem continuar versionadas e executadas na ordem do nome. A opção de confirmação de e-mail é uma configuração do Supabase Auth e não deve ser alterada por SQL.

Não coloque a chave secret/service role em nenhuma variável `VITE_*`.
