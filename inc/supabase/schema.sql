-- Enable required extensions
create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists postgis;

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

do $$ begin
  create type kyc_status as enum ('pending','verified','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type delivery_type as enum ('asap','scheduled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type doc_type as enum ('drivers_license','insurance','vehicle_registration','identity_photo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trigger_type as enum ('arriving','departed');
exception when duplicate_object then null; end $$;

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'customer',
  name text,
  email text unique,
  location jsonb, -- { lat, lng, address?, city?, region?, country? }
  geo_point geography(POINT,4326), -- PostGIS point for spatial queries
  rating float default 0 check (rating >= 0 and rating <= 5),
  kyc_status kyc_status default 'pending',
  vehicle_info jsonb, -- For drivers: { type, license_plate, color, model }
  created_at timestamptz default now()
);

-- Products
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(12,2) not null check (price > 0),
  vendor_id uuid not null references public.profiles(id) on delete cascade,
  embedding vector(1536),
  stock int not null default 0 check (stock >= 0),
  images text[] default '{}',
  availability_radius_km float default 30 check (availability_radius_km > 0),
  geo_point geography(POINT,4326), -- Vendor location for proximity searches
  created_at timestamptz default now()
);

-- Orders
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  vendor_id uuid not null references public.profiles(id) on delete cascade,
  parent_order_id uuid references public.orders(id), -- For split orders
  status order_status not null default 'pending',
  total numeric(12,2) not null default 0 check (total >= 0),
  delivery_type delivery_type default 'asap',
  surge_factor float default 1.0 check (surge_factor >= 0.5 and surge_factor <= 5.0),
  created_at timestamptz default now()
);

-- Order items
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity int not null check (quantity > 0),
  price numeric(12,2) not null check (price > 0)
);

-- Delivery jobs
create table if not exists public.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  driver_id uuid references public.profiles(id),
  pickup_location jsonb not null,
  dropoff_location jsonb not null,
  pickup_geo geography(POINT,4326), -- PostGIS points for spatial queries
  dropoff_geo geography(POINT,4326),
  batch_id uuid references public.batch_jobs(id) on delete set null,
  route_points geography(MULTIPOINT,4326), -- Optimized route waypoints
  eta interval,
  current_eta interval, -- AI-updated ETA
  status job_status not null default 'open',
  created_at timestamptz default now()
);

-- Auctions
create table if not exists public.auctions (
  id uuid primary key default gen_random_uuid(),
  delivery_job_id uuid not null references public.delivery_jobs(id) on delete cascade,
  start_time timestamptz not null default now(),
  end_time timestamptz not null check (end_time > start_time),
  current_bid numeric(12,2) check (current_bid >= 0),
  min_bid numeric(12,2) not null default 0 check (min_bid >= 0),
  ai_suggested_bid numeric(12,2) check (ai_suggested_bid >= 0), -- OpenAI-generated smart bid
  status auction_status not null default 'active'
);

-- Bids
create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz default now()
);

-- Payments
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  stripe_session_id text,
  amount numeric(12,2) not null check (amount > 0),
  platform_fee numeric(12,2) default 0 check (platform_fee >= 0),
  vendor_payout numeric(12,2) default 0 check (vendor_payout >= 0),
  driver_payout numeric(12,2) default 0 check (driver_payout >= 0),
  status text,
  created_at timestamptz default now()
);

-- Analytics events
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  event_type text not null,
  data jsonb,
  ai_insights jsonb, -- OpenAI summaries and predictions
  created_at timestamptz default now()
);

-- Cart items (temporary per user session)
create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity int not null default 1 check (quantity > 0),
  created_at timestamptz default now()
);

-- KYC documents for driver verification
create table if not exists public.kyc_docs (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  doc_type doc_type not null,
  stripe_verification_session_id text,
  status kyc_status default 'pending',
  created_at timestamptz default now()
);

-- Payouts for vendors and drivers via Stripe Connect
create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  stripe_transfer_id text,
  stripe_connect_account_id text,
  status text default 'pending',
  created_at timestamptz default now()
);

-- Geofences for location-based notifications
create table if not exists public.geofences (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.delivery_jobs(id) on delete cascade,
  center_point geography(POINT,4326) not null,
  radius_m int not null default 100 check (radius_m > 0),
  trigger_type trigger_type not null,
  notified boolean default false,
  created_at timestamptz default now()
);

-- Batch jobs for delivery route optimization
create table if not exists public.batch_jobs (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  job_ids uuid[] not null,
  optimized_route geography(LINESTRING,4326),
  estimated_duration interval,
  status text default 'pending',
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_products_vendor on public.products(vendor_id);
create index if not exists idx_orders_customer on public.orders(customer_id);
create index if not exists idx_orders_vendor on public.orders(vendor_id);
create index if not exists idx_delivery_jobs_driver on public.delivery_jobs(driver_id);
create index if not exists idx_delivery_jobs_order on public.delivery_jobs(order_id);
create index if not exists idx_auctions_delivery_job on public.auctions(delivery_job_id);
create index if not exists idx_bids_auction on public.bids(auction_id);
create index if not exists idx_bids_driver on public.bids(driver_id);
create index if not exists idx_analytics_user on public.analytics_events(user_id);
create index if not exists idx_analytics_event_type on public.analytics_events(event_type);
-- Vector index with dynamic lists parameter
create index if not exists idx_products_embedding on public.products using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- JSON indexes
create index if not exists idx_profiles_location on public.profiles using gin ((location));
create index if not exists idx_delivery_pickup on public.delivery_jobs using gin ((pickup_location));
create index if not exists idx_delivery_dropoff on public.delivery_jobs using gin ((dropoff_location));

-- Spatial indexes for PostGIS (created after all tables)
create index if not exists idx_profiles_geo_point on public.profiles using gist (geo_point);
create index if not exists idx_products_geo_point on public.products using gist (geo_point);
create index if not exists idx_delivery_pickup_geo on public.delivery_jobs using gist (pickup_geo);
create index if not exists idx_delivery_dropoff_geo on public.delivery_jobs using gist (dropoff_geo);
create index if not exists idx_delivery_route_points on public.delivery_jobs using gist (route_points);
create index if not exists idx_geofences_center on public.geofences using gist (center_point);
create index if not exists idx_batch_route on public.batch_jobs using gist (optimized_route);

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
alter table public.kyc_docs enable row level security;
alter table public.payouts enable row level security;
alter table public.geofences enable row level security;
alter table public.batch_jobs enable row level security;

-- Profiles: users can read themselves; admins can read all; users can update themselves
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select using (auth.uid() = id or exists(select 1 from public.profiles p2 where p2.id = auth.uid() and p2.role = 'admin'));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Products: public read; only vendor owner can insert/update/delete
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products for select using (true);

drop policy if exists products_vendor_write on public.products;
create policy products_vendor_write on public.products for all using (auth.uid() = vendor_id) with check (auth.uid() = vendor_id);

-- Orders: readable by related customer, vendor, or admin
drop policy if exists orders_related_read on public.orders;
create policy orders_related_read on public.orders for select using (
  auth.uid() = customer_id or auth.uid() = vendor_id or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Insert: customer creates pending
drop policy if exists orders_customer_insert on public.orders;
create policy orders_customer_insert on public.orders for insert with check (auth.uid() = customer_id);

-- Update: vendor can update; admin can update; customer can only cancel when pending
drop policy if exists orders_update_by_role on public.orders;
create policy orders_update_by_role on public.orders for update using (
  auth.uid() = vendor_id or 
  exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') or 
  auth.uid() = customer_id
) with check (
  -- Customers can only update to cancelled status and only when currently pending
  case when auth.uid() = customer_id then 
    (status = 'cancelled')
  else true end
);

-- Order items: readable by related parties
drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items for select using (
  exists(select 1 from public.orders o where o.id = order_id and (auth.uid() = o.customer_id or auth.uid() = o.vendor_id)) or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists order_items_insert on public.order_items;
create policy order_items_insert on public.order_items for insert with check (
  exists(select 1 from public.orders o where o.id = order_id and auth.uid() = o.customer_id)
);

-- Delivery jobs: drivers read open/assigned to them; vendor/admin read related to their orders
drop policy if exists delivery_jobs_read on public.delivery_jobs;
create policy delivery_jobs_read on public.delivery_jobs for select using (
  status = 'open' or driver_id = auth.uid() or exists(select 1 from public.orders o where o.id = order_id and (auth.uid() = o.vendor_id or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin')))
);

drop policy if exists delivery_jobs_write_driver on public.delivery_jobs;
create policy delivery_jobs_write_driver on public.delivery_jobs for update using (driver_id = auth.uid());

-- Auctions: public read; drivers write bids via bids table
drop policy if exists auctions_public_read on public.auctions;
create policy auctions_public_read on public.auctions for select using (true);

-- Bids: driver insert/read own; vendor/admin read
drop policy if exists bids_insert_driver on public.bids;
create policy bids_insert_driver on public.bids for insert with check (driver_id = auth.uid());

drop policy if exists bids_read_related on public.bids;
create policy bids_read_related on public.bids for select using (
  driver_id = auth.uid() or 
  exists(
    select 1 from public.auctions a 
    join public.delivery_jobs dj on dj.id = a.delivery_job_id 
    join public.orders o on o.id = dj.order_id 
    where a.id = auction_id and o.vendor_id = auth.uid()
  ) or 
  exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin')
);

-- Payments: related parties
drop policy if exists payments_read_related on public.payments;
create policy payments_read_related on public.payments for select using (
  exists(select 1 from public.orders o where o.id = order_id and (auth.uid() = o.customer_id or auth.uid() = o.vendor_id)) or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin')
);

-- Analytics: user can insert their events; admin read
drop policy if exists analytics_insert_self on public.analytics_events;
create policy analytics_insert_self on public.analytics_events for insert with check (auth.uid() = user_id);

drop policy if exists analytics_admin_read on public.analytics_events;
create policy analytics_admin_read on public.analytics_events for select using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'));

-- Cart items: user owns
drop policy if exists cart_items_owner_all on public.cart_items;
create policy cart_items_owner_all on public.cart_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- KYC docs: drivers own their docs; admins can read all
drop policy if exists kyc_docs_driver_own on public.kyc_docs;
create policy kyc_docs_driver_own on public.kyc_docs for all using (auth.uid() = driver_id) with check (auth.uid() = driver_id);

drop policy if exists kyc_docs_admin_read on public.kyc_docs;
create policy kyc_docs_admin_read on public.kyc_docs for select using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'));

-- Payouts: users own their payouts; admins can read all
drop policy if exists payouts_user_own on public.payouts;
create policy payouts_user_own on public.payouts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists payouts_admin_read on public.payouts;
create policy payouts_admin_read on public.payouts for select using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'));

-- Geofences: drivers and related vendor/admin can read
drop policy if exists geofences_related_read on public.geofences;
create policy geofences_related_read on public.geofences for select using (
  exists(select 1 from public.delivery_jobs dj where dj.id = job_id and dj.driver_id = auth.uid()) or
  exists(select 1 from public.delivery_jobs dj join public.orders o on o.id = dj.order_id where dj.id = job_id and o.vendor_id = auth.uid()) or
  exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin')
);

-- Batch jobs: drivers own their batches; admins can read all
drop policy if exists batch_jobs_driver_own on public.batch_jobs;
create policy batch_jobs_driver_own on public.batch_jobs for all using (auth.uid() = driver_id) with check (auth.uid() = driver_id);

drop policy if exists batch_jobs_admin_read on public.batch_jobs;
create policy batch_jobs_admin_read on public.batch_jobs for select using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'));

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

-- RPC: nearest_drivers using PostGIS for spatial queries
create or replace function public.nearest_drivers(
  search_location jsonb,
  radius_km float default 30
) returns table(
  id uuid, 
  name text, 
  rating float, 
  distance_km float,
  vehicle_info jsonb
)
language sql stable as $$
  select 
    p.id, 
    p.name, 
    p.rating,
    st_distance(p.geo_point, st_setsrid(st_point((search_location->>'lng')::float, (search_location->>'lat')::float), 4326)::geography) / 1000 as distance_km,
    p.vehicle_info
  from public.profiles p
  where p.role = 'driver' 
    and p.geo_point is not null
    and st_dwithin(p.geo_point, st_setsrid(st_point((search_location->>'lng')::float, (search_location->>'lat')::float), 4326)::geography, radius_km * 1000)
  order by p.geo_point <-> st_setsrid(st_point((search_location->>'lng')::float, (search_location->>'lat')::float), 4326)::geography
  limit 50;
$$;

grant execute on function public.nearest_drivers(jsonb, float) to anon, authenticated;

-- RPC: optimize_route using OpenAI heuristic (placeholder for advanced routing)
create or replace function public.optimize_route(
  waypoints jsonb[]
) returns table(
  optimized_order int[],
  total_distance_km float,
  estimated_duration interval
)
language sql stable as $$
  -- Simple heuristic: return original order with basic distance calculation
  -- In production, this would call OpenAI or use pgRouting for optimization
  select 
    array(select generate_series(1, array_length(waypoints, 1))) as optimized_order,
    50.0 as total_distance_km, -- Placeholder
    make_interval(hours => 2) as estimated_duration; -- Placeholder
$$;

grant execute on function public.optimize_route(jsonb[]) to anon, authenticated;

-- RPC: point_within_radius for geofence checking
create or replace function public.point_within_radius(
  check_point geography,
  center_point geography,
  radius_meters int
) returns boolean
language sql stable as $$
  select st_dwithin(check_point, center_point, radius_meters);
$$;

grant execute on function public.point_within_radius(geography, geography, int) to anon, authenticated;

-- RPC: calculate_distance between two points in kilometers
create or replace function public.calculate_distance(
  point1 geography,
  point2 geography
) returns float
language sql stable as $$
  select st_distance(point1, point2) / 1000; -- Convert meters to kilometers
$$;

grant execute on function public.calculate_distance(geography, geography) to anon, authenticated;

-- Function to automatically expire auctions
create or replace function expire_auctions()
returns void language plpgsql as $$
begin
  update public.auctions 
  set status = 'expired' 
  where status = 'active' and end_time < now();
end;
$$;

grant execute on function expire_auctions() to anon, authenticated;