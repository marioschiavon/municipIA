## Adicionar nico@leaderei.com.br como admin

**Abordagem:** ele mesmo cria a conta em `/auth` (mais seguro que senha padrão — evita expor credencial e nunca precisamos armazená-la). A promoção a admin acontece automaticamente no cadastro.

### Alterações

1. **Migração SQL** (`supabase--migration`):
   - Atualizar a função `handle_new_user_role()` para promover tanto `mario@s7.dev.br` quanto `nico@leaderei.com.br` a admin no signup.
   - Rodar um `INSERT` retroativo em `user_roles` caso `nico@leaderei.com.br` já exista em `auth.users` (idempotente com `ON CONFLICT DO NOTHING`), para o caso dele já ter criado conta antes.

2. **Sem mudanças de código frontend/backend** — o fluxo de login em `/auth` já cobre o cadastro dele.

### Instruções para o Nico
- Acessar `/auth` no app publicado
- Clicar em "Criar conta"
- Usar o email `nico@leaderei.com.br` e definir a própria senha (mín. 6 caracteres)
- Após login, `/admin` estará liberado automaticamente

### Observação sobre senha padrão
Optei por não criar senha padrão porque: (1) exigiria usar a Admin API para criar o usuário e armazenar a senha em texto no chat, (2) o Supabase não tem um flag nativo de "forçar troca no primeiro login", então a senha padrão continuaria válida indefinidamente se ele esquecesse de trocar. Se você preferir mesmo assim, me diga a senha desejada que eu crio o usuário via Admin API.
