-- My JSPD mobile support for employee documents + job photo uploads.
--
-- Safe for the existing JSPD Hub document model:
-- - does not add duplicate employee document columns
-- - does not replace Hub document policies
-- - does not add a mobile document-signing RPC
-- - keeps employee document signing in the Hub API, where PDF regeneration happens
--
-- Run this after the Hub migrations that create:
-- - employee_documents
-- - employee_document_items
-- - employee_document_signatures
-- - employee_document_audit_events
-- - job_photos

create extension if not exists pgcrypto;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'job-photos',
  'job-photos',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.job_photos
  add column if not exists company_id uuid null references public.companies(id) on delete cascade,
  add column if not exists uploaded_by uuid null references public.profiles(id) on delete set null,
  add column if not exists mime_type text null,
  add column if not exists size_bytes bigint null,
  add column if not exists thumb_size_bytes bigint null;

update public.job_photos photo
set company_id = job.company_id
from public.jobs job
where job.id = photo.job_id
  and photo.company_id is null;

create index if not exists job_photos_company_job_taken_idx
  on public.job_photos(company_id, job_id, taken_at desc);

alter table public.job_photos enable row level security;

drop policy if exists my_jspd_mobile_job_photos_select on public.job_photos;
drop policy if exists my_jspd_mobile_job_photos_insert on public.job_photos;
drop policy if exists my_jspd_mobile_job_photos_update on public.job_photos;

create policy my_jspd_mobile_job_photos_select
on public.job_photos
for select
to authenticated
using (
  exists (
    select 1
    from public.jobs job
    where job.id = job_photos.job_id
      and (
        public.is_company_admin(job.company_id)
        or public.is_worker_assigned_to_job(job.id)
      )
  )
);

create policy my_jspd_mobile_job_photos_insert
on public.job_photos
for insert
to authenticated
with check (
  exists (
    select 1
    from public.jobs job
    where job.id = job_photos.job_id
      and (job_photos.company_id is null or job_photos.company_id = job.company_id)
      and (
        public.is_company_admin(job.company_id)
        or public.is_worker_assigned_to_job(job.id)
      )
  )
  and (uploaded_by is null or uploaded_by = public.current_profile_id())
);

create policy my_jspd_mobile_job_photos_update
on public.job_photos
for update
to authenticated
using (
  exists (
    select 1
    from public.jobs job
    where job.id = job_photos.job_id
      and (
        public.is_company_admin(job.company_id)
        or public.is_worker_assigned_to_job(job.id)
      )
  )
)
with check (
  exists (
    select 1
    from public.jobs job
    where job.id = job_photos.job_id
      and (job_photos.company_id is null or job_photos.company_id = job.company_id)
      and (
        public.is_company_admin(job.company_id)
        or public.is_worker_assigned_to_job(job.id)
      )
  )
  and (uploaded_by is null or uploaded_by = public.current_profile_id())
);

create or replace function public.my_jspd_mobile_job_photo_storage_job_id(object_name text)
returns uuid
language plpgsql
stable
set search_path = public, storage
as $$
declare
  first_folder text;
  second_folder text;
  first_uuid uuid;
  second_uuid uuid;
begin
  first_folder := (storage.foldername(object_name))[1];
  second_folder := (storage.foldername(object_name))[2];

  if first_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    first_uuid := first_folder::uuid;
  end if;

  if second_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    second_uuid := second_folder::uuid;
  end if;

  if first_uuid is not null and exists (
    select 1 from public.jobs job where job.id = first_uuid
  ) then
    return first_uuid;
  end if;

  if second_uuid is not null and exists (
    select 1
    from public.jobs job
    where job.id = second_uuid
      and (first_uuid is null or job.company_id = first_uuid)
  ) then
    return second_uuid;
  end if;

  return null;
end;
$$;

revoke all on function public.my_jspd_mobile_job_photo_storage_job_id(text) from public;
grant execute on function public.my_jspd_mobile_job_photo_storage_job_id(text) to authenticated;

drop policy if exists my_jspd_mobile_job_photos_storage_select on storage.objects;
drop policy if exists my_jspd_mobile_job_photos_storage_insert on storage.objects;

create policy my_jspd_mobile_job_photos_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'job-photos'
  and exists (
    select 1
    from public.jobs job
    where job.id = public.my_jspd_mobile_job_photo_storage_job_id(name)
      and (
        public.is_company_admin(job.company_id)
        or public.is_worker_assigned_to_job(job.id)
      )
  )
);

create policy my_jspd_mobile_job_photos_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'job-photos'
  and exists (
    select 1
    from public.jobs job
    where job.id = public.my_jspd_mobile_job_photo_storage_job_id(name)
      and (
        public.is_company_admin(job.company_id)
        or public.is_worker_assigned_to_job(job.id)
      )
  )
);

grant select, insert, update on public.job_photos to authenticated;

-- Mobile reads employee documents directly through Supabase RLS.
-- Existing Hub RLS still decides which rows are visible.
grant select on public.employee_documents to authenticated;
grant select on public.employee_document_items to authenticated;
grant select on public.employee_document_signatures to authenticated;
grant select on public.employee_document_audit_events to authenticated;
