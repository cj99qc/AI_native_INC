-- Enable required extensions
create extension if not exists pgcrypto;
create extension if not exists vector;

-- Types
do $$ begin
  create type user_role as enum ('customer', 'vendor', 'driver', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('pending','paid','shipped','delivered','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_status as enum ('open','assigned','in_transit','completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type auction_status as enum ('active','expired','awarded');
exception when duplicate_object then null; end $$;

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'customer',
  name text,
  email text unique,
  location jsonb, -- { lat, lng }
  rating float default 0,
  created_at timestamptz default now()
);

-- Products
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(12,2) not null,
  vendor_id uuid not null references public.profiles(id) on delete cascade,
  embedding vector(1536),
  stock int not null default 0,
  images text[] default '{}',
  created_at timestamptz default now()
);

-- Orders
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  vendor_id uuid not null references public.profiles(id) on delete cascade,
  status order_status not null default 'pending',
  total numeric(12,2) not null default 0,
  created_at timestamptz default now()
);

-- Order items
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity int not null,
  price numeric(12,2) not null
);

-- Delivery jobs
create table if not exists public.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  driver_id uuid references public.profiles(id),
  pickup_location jsonb not null,
  dropoff_location jsonb not null,
  eta interval,
  status job_status not null default 'open',
  created_at timestamptz default now()
);

-- Auctions
create table if not exists public.auctions (
  id uuid primary key default gen_random_uuid(),
  delivery_job_id uuid not null references public.delivery_jobs(id) on delete cascade,
  start_time timestamptz not null default now(),
  end_time timestamptz not null,
  current_bid numeric(12,2),
  min_bid numeric(12,2) not null default 0,
  status auction_status not null default 'active'
);

-- Bids
create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null,
  created_at timestamptz default now()
);

-- Payments
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  stripe_session_id text,
  amount numeric(12,2) not null,
  status text,
  created_at timestamptz default now()
);

-- Analytics events
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  event_type text not null,
  data jsonb,
  created_at timestamptz default now()
);

-- Cart items (temporary per user session)
create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity int not null default 1,
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_products_vendor on public.products(vendor_id);
create index if not exists idx_orders_customer on public.orders(customer_id);
create index if not exists idx_orders_vendor on public.orders(vendor_id);
create index if not exists idx_products_embedding on public.products using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_profiles_location on public.profiles using gin ((location));
create index if not exists idx_delivery_pickup on public.delivery_jobs using gin ((pickup_location));
create index if not exists idx_delivery_dropoff on public.delivery_jobs using gin ((dropoff_location));
create index if not exists idx_events_data on public.analytics_events using gin ((data));

-- RLS
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.delivery_jobs enable row level security;
alter table public.auctions enable row level security;
alter table public.bids enable row level security;
alter table public.payments enable row level security;
alter table public.analytics_events enable row level security;
alter table public.cart_items enable row level security;

-- Profiles: users can read themselves; admins can read all; users can update themselves
create policy if not exists profiles_select_self on public.profiles for select using (auth.uid() = id or exists(select 1 from public.profiles p2 where p2.id = auth.uid() and p2.role = 'admin'));
create policy if not exists profiles_update_self on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Products: public read; only vendor owner can insert/update/delete
create policy if not exists products_public_read on public.products for select using (true);
create policy if not exists products_vendor_write on public.products for all using (auth.uid() = vendor_id) with check (auth.uid() = vendor_id);

-- Orders: readable by related customer, vendor, or admin
create policy if not exists orders_related_read on public.orders for select using (
  auth.uid() = customer_id or auth.uid() = vendor_id or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
-- Insert: customer creates pending
create policy if not exists orders_customer_insert on public.orders for insert with check (auth.uid() = customer_id);
-- Update: vendor can update when status >= paid for fulfillment; admin can update; customer can cancel when pending
create policy if not exists orders_update_by_role on public.orders for update using (
  auth.uid() = vendor_id or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') or (auth.uid() = customer_id)
) with check (true);

-- Order items: readable by related parties
create policy if not exists order_items_read on public.order_items for select using (
  exists(select 1 from public.orders o where o.id = order_id and (auth.uid() = o.customer_id or auth.uid() = o.vendor_id)) or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy if not exists order_items_insert on public.order_items for insert with check (
  exists(select 1 from public.orders o where o.id = order_id and auth.uid() = o.customer_id)
);

-- Delivery jobs: drivers read open/assigned to them; vendor/admin read related to their orders
create policy if not exists delivery_jobs_read on public.delivery_jobs for select using (
  status = 'open' or driver_id = auth.uid() or exists(select 1 from public.orders o where o.id = order_id and (auth.uid() = o.vendor_id or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin')))
);
create policy if not exists delivery_jobs_write_driver on public.delivery_jobs for update using (driver_id = auth.uid());

-- Auctions: public read; drivers write bids via bids table
create policy if not exists auctions_public_read on public.auctions for select using (true);

-- Bids: driver insert/read own; vendor/admin read
create policy if not exists bids_insert_driver on public.bids for insert with check (driver_id = auth.uid());
create policy if not exists bids_read_related on public.bids for select using (
  driver_id = auth.uid() or exists(select 1 from public.delivery_jobs dj join public.orders o on o.id = dj.order_id where dj.id = auction_id and (o.vendor_id = auth.uid())) or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin')
);

-- Payments: related parties
create policy if not exists payments_read_related on public.payments for select using (
  exists(select 1 from public.orders o where o.id = order_id and (auth.uid() = o.customer_id or auth.uid() = o.vendor_id)) or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin')
);

-- Analytics: user can insert their events; admin read
create policy if not exists analytics_insert_self on public.analytics_events for insert with check (auth.uid() = user_id);
create policy if not exists analytics_admin_read on public.analytics_events for select using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'));

-- Cart items: user owns
create policy if not exists cart_items_owner_all on public.cart_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- RPC: match_products
create or replace function public.match_products(
  query_embedding vector(1536),
  match_threshold float, 
  match_count int
) returns table(id uuid, name text, description text, price numeric, similarity float)
language sql stable as $$
  select p.id, p.name, p.description, p.price, 1 - (p.embedding <-> query_embedding) as similarity
  from public.products p
  where p.embedding is not null and (1 - (p.embedding <-> query_embedding)) >= match_threshold
  order by p.embedding <-> query_embedding
  limit match_count;
$$;

-- Grant execute to anon and authenticated
grant execute on function public.match_products(vector, float, int) to anon, authenticated;

-- RPC: calculate_eta (dummy heuristic in SQL). For more advanced use, an Edge Function can be used.
create or replace function public.calculate_eta(distance_km float)
returns interval language sql stable as $$
  -- Simple heuristic: base 10 minutes + 3 minutes per km, capped at 3 hours
  select make_interval(mins => least(10 + (distance_km * 3)::int, 180));
$$;

grant execute on function public.calculate_eta(float) to anon, authenticated;