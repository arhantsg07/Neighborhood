-- Run as postgres against a disposable, migrated Supabase database.
-- All fixtures, helper functions, and mutations are rolled back.
begin;

create function public._backend_test_assert(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAILED: %', label; end if;
end;
$$;
create function public._backend_test_error(statement text, expected_state text) returns void
language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise exception 'Expected SQLSTATE %, got % for %: %', expected_state, sqlstate, statement, sqlerrm;
  end;
  raise exception 'Expected SQLSTATE % but statement succeeded: %', expected_state, statement;
end;
$$;
grant execute on function public._backend_test_assert(boolean, text), public._backend_test_error(text, text)
  to anon, authenticated, service_role;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'backend-test-one@example.invalid', '{"is_admin":true}'),
  ('22222222-2222-4222-8222-222222222222', 'backend-test-two@example.invalid', '{}');
select public._backend_test_assert(
  (select count(*) = 2 and not bool_or(is_admin) from public.profiles
    where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')),
  'trigger creates non-admin profiles and ignores metadata'
);
insert into storage.objects (bucket_id, name) values
  ('report-images', '11111111-1111-4111-8111-111111111111/published.jpg'),
  ('report-images', '11111111-1111-4111-8111-111111111111/temporary.jpg'),
  ('report-images', '22222222-2222-4222-8222-222222222222/other.jpg');

set local role anon;
select public._backend_test_error('select * from public.reports', '42501');
select public._backend_test_error('select public.toggle_upvote(gen_random_uuid())', '42501');
select public._backend_test_error('select public.set_report_status(gen_random_uuid(), ''Resolved'')', '42501');
select public._backend_test_error('select public.claim_ai_request(gen_random_uuid())', '42501');
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select public._backend_test_assert((select count(*) = 1 from public.profiles), 'only own profile visible');
select public._backend_test_error('update public.profiles set is_admin = true', '42501');
select public._backend_test_error('insert into public.profiles (id,is_admin) values (auth.uid(),true)', '42501');
select public._backend_test_error('delete from public.profiles', '42501');
select public._backend_test_error('select public.claim_ai_request(auth.uid())', '42501');

insert into public.reports (user_id, image_url, category, description, severity, latitude, longitude)
values (auth.uid(), auth.uid()::text || '/published.jpg', 'Pothole', 'A visible pothole in the road.', 'Medium', 90, -180);
select public._backend_test_assert((select status = 'Submitted' from public.reports where user_id = auth.uid()), 'Submitted default');
select public._backend_test_error('update public.reports set status = ''Resolved''', '42501');
select public._backend_test_error('delete from public.reports', '42501');
select public._backend_test_error('insert into public.upvotes select id,auth.uid() from public.reports', '42501');
select public._backend_test_error('delete from public.upvotes', '42501');
select public._backend_test_error('select public.set_report_status(id,''Resolved'') from public.reports', '42501');
select public._backend_test_error($q$
  insert into public.reports (user_id,image_url,category,description,severity,latitude,longitude,status)
  values (auth.uid(),auth.uid()::text || '/published.jpg','Pothole','A visible pothole in the road.','Medium',0,0,'Resolved')
$q$, '42501');
select public._backend_test_error($q$
  insert into public.reports (user_id,image_url,category,description,severity,latitude,longitude)
  values ('22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222/other.jpg','Other','A visible issue in the road.','Low',0,0)
$q$, '42501');
select public._backend_test_error($q$
  insert into public.reports (user_id,image_url,category,description,severity,latitude,longitude)
  values (auth.uid(),auth.uid()::text || '/missing.jpg','Other','A visible issue in the road.','Low',0,0)
$q$, '42501');
select public._backend_test_error($q$
  insert into public.reports (user_id,image_url,category,description,severity,latitude,longitude)
  values (auth.uid(),auth.uid()::text || '/published.jpg','Other','too short','Low',0,0)
$q$, '23514');
select public._backend_test_error($q$
  insert into public.reports (user_id,image_url,category,description,severity,latitude,longitude)
  values (auth.uid(),auth.uid()::text || '/published.jpg','Other',repeat(' ',2000) || 'A visible issue in the road.','Low',0,0)
$q$, '23514');
select public._backend_test_error($q$
  insert into public.reports (user_id,image_url,category,description,severity,latitude,longitude)
  values (auth.uid(),auth.uid()::text || '/published.jpg','Other','A visible issue in the road.','Low',91,0)
$q$, '23514');
select public._backend_test_error($q$
  insert into public.reports (user_id,image_url,category,description,severity,latitude,longitude)
  values (auth.uid(),auth.uid()::text || '/published.jpg','Other','A visible issue in the road.','Low',0,'NaN')
$q$, '23514');

select public.toggle_upvote(id) from public.reports where user_id = auth.uid();
select public._backend_test_assert((select count(*) = 1 from public.upvotes where user_id = auth.uid()), 'first toggle adds one vote');
select public.toggle_upvote(id) from public.reports where user_id = auth.uid();
select public._backend_test_assert((select count(*) = 0 from public.upvotes where user_id = auth.uid()), 'second toggle removes vote');
select public._backend_test_error('select public.toggle_upvote(''00000000-0000-4000-8000-000000000000'')', 'P0002');
insert into public.comments (report_id,user_id,body) select id,auth.uid(),'Please repair this.' from public.reports where user_id = auth.uid();
select public._backend_test_error('insert into public.comments (report_id,user_id,body) select id,auth.uid(),'' '' from public.reports', '23514');
select public._backend_test_error('insert into public.comments (report_id,user_id,body) select id,auth.uid(),repeat('' '',1000) || ''x'' from public.reports', '23514');
select public._backend_test_error('insert into public.comments (report_id,user_id,body) select id,''22222222-2222-4222-8222-222222222222'',''Spoofed'' from public.reports', '42501');
insert into storage.objects (bucket_id,name) values ('report-images',auth.uid()::text || '/new.png');
select public._backend_test_error('insert into storage.objects (bucket_id,name) values (''report-images'',''22222222-2222-4222-8222-222222222222/forbidden.jpg'')', '42501');
select public._backend_test_assert((select count(*) = 0 from storage.objects where name = '22222222-2222-4222-8222-222222222222/other.jpg'), 'other unpublished object is hidden');
-- RLS DELETE silently filters other people's rows rather than raising an error.
delete from storage.objects where name = '22222222-2222-4222-8222-222222222222/other.jpg';
reset role;
select public._backend_test_assert((select count(*) = 1 from storage.objects where name = '22222222-2222-4222-8222-222222222222/other.jpg'), 'cross-owner deletion did nothing');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select public._backend_test_assert((select count(*) = 1 from public.reports where user_id <> auth.uid()), 'community reports readable');
select public._backend_test_assert((select count(*) = 1 from public.comments where user_id <> auth.uid()), 'community comments readable');
select public._backend_test_assert((select count(*) = 1 from storage.objects where name = '11111111-1111-4111-8111-111111111111/published.jpg'), 'community published image readable for signing');
select public._backend_test_assert((select count(*) = 0 from storage.objects where name = '11111111-1111-4111-8111-111111111111/temporary.jpg'), 'community cannot list or sign another temporary image');
reset role;

update public.profiles set is_admin = true where id = '22222222-2222-4222-8222-222222222222';
set local role authenticated;
select public.set_report_status(id,'In progress') from public.reports where user_id <> auth.uid();
select public.set_report_status(id,'Resolved') from public.reports where user_id <> auth.uid();
select public._backend_test_assert((select status = 'Resolved' from public.reports where user_id <> auth.uid()), 'admin RPC changes status');
select public._backend_test_error('select public.set_report_status(id,''Invalid'') from public.reports', '22023');
select public._backend_test_error('select public.set_report_status(id,null) from public.reports', '22023');
select public._backend_test_error('update public.reports set description = ''Admin arbitrary edit''', '42501');
select public._backend_test_error('update public.profiles set is_admin = false', '42501');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
begin
  for i in 1..10 loop
    perform public._backend_test_assert(public.claim_ai_request('11111111-1111-4111-8111-111111111111'), 'first 10 claims allowed');
  end loop;
  perform public._backend_test_assert(not public.claim_ai_request('11111111-1111-4111-8111-111111111111'), '11th claim denied');
  perform public._backend_test_assert(public.claim_ai_request('22222222-2222-4222-8222-222222222222'), 'quota isolated by user');
end;
$$;
reset role;
update private.ai_request_limits set requested_at = array[clock_timestamp() - interval '61 minutes']
  where user_id = '11111111-1111-4111-8111-111111111111';
set local role service_role;
select public._backend_test_assert(public.claim_ai_request('11111111-1111-4111-8111-111111111111'), 'expired claims pruned');
reset role;

select 'Backend SQL checks passed (transaction will roll back).' as result;
rollback;
