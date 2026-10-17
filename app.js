import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const announcements = [];
const resources = [];
const events = [];
const $ = (selector, root=document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatDate = value => { if (!value) return 'Date to be confirmed'; const d = new Date(`${value}T12:00:00`); return Number.isNaN(d.getTime()) ? 'Date to be confirmed' : new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(d); };
let client = null, currentUser = null, editing = null, contentToDelete = null;
let liveAnnouncements = announcements;

function renderAnnouncements(rows=announcements) {
  const term = $('#announcementSearch').value.trim().toLowerCase(), category = $('#announcementCategory').value;
  const filtered = rows.filter(x => (category === 'all' || x.category === category) && `${x.title} ${x.body} ${x.issuer}`.toLowerCase().includes(term)).sort((a,b) => Number(b.pinned)-Number(a.pinned) || String(b.date).localeCompare(String(a.date)));
  $('#announcementCount').textContent = `${filtered.length} ${filtered.length === 1 ? 'notice' : 'notices'}`;
  $('#announcementList').innerHTML = filtered.length ? filtered.map(x => `<article class="item${x.pinned?' pinned':''}"><div class="item-meta"><span class="tag">${esc(x.category)}</span>${x.pinned?'<span class="tag">Pinned</span>':''}<span>${esc(formatDate(x.date))}</span><span>Issued by ${esc(x.issuer || 'School office')}</span></div><h3>${esc(x.title)}</h3><p>${esc(x.body)}</p></article>`).join('') : '<p class="empty">No announcements have been published.</p>';
}
function renderResources() {
  const term=$('#resourceSearch').value.trim().toLowerCase(), category=$('#resourceCategory').value;
  const rows=resources.filter(x=>(category==='all'||x.category===category)&&`${x.title} ${x.subject} ${x.description}`.toLowerCase().includes(term));
  $('#resourceList').innerHTML=rows.length?rows.map(x=>`<article class="item"><div class="item-meta"><span class="tag">${esc(x.category)}</span><span>${esc(x.subject)}</span></div><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p>${x.url&&/^https:\/\//i.test(x.url)?`<a class="card-link" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Open resource (new tab) →</a>`:''}</article>`).join(''):'<p class="empty">No resources have been published.</p>';
}
function renderEvents(rows=events) {
  const upcoming=[...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  $('#eventList').innerHTML=upcoming.length?upcoming.map(x=>`<article class="item"><div class="item-meta"><span class="tag">Upcoming event</span><span>${esc(formatDate(x.date))}</span><span>${esc(x.location || 'Location not listed')}</span></div><h3>${esc(x.title)}</h3><p>${esc(x.body)}</p></article>`).join(''):'<p class="empty">No upcoming events have been published.</p>';
}
function setAuthStatus(message,error=false){const node=$('#authStatus');node.textContent=message;node.classList.toggle('error',error)}
function setEditorStatus(message,error=false){const node=$('#editorStatus');node.textContent=message;node.classList.toggle('error',error)}
function showAuth(mode='login') {
  $('#accountPanel').classList.remove('hidden'); $('#accountPanel').scrollIntoView({behavior:'smooth',block:'start'});
  $('#accountTitle').textContent=mode==='signup'?'Create account':'Sign in';
  $('#authSubmit').textContent=mode==='signup'?'Create account':'Sign in';
  $('#switchAuth').classList.remove('hidden');$('#resetPassword').classList.remove('hidden');$('#authEmail').closest('.field').classList.remove('hidden');
  $('#signupFields').classList.toggle('hidden',mode!=='signup');
  $('#termsAccepted').required=mode==='signup';
  $('#authPassword').autocomplete=mode==='signup'?'new-password':'current-password';
}
async function authUI() {
  $('#accountTitle').textContent=currentUser?'Your account':'Sign in';
  $('#accountDescription').textContent=currentUser
    ? 'You are signed in. Student access requires email confirmation, school membership review, and an assigned role.'
    : client?'Sign in or create an account. Email confirmation is required before protected student access.'
      :'Authentication is unavailable until Supabase is configured.';
  $('#accountButton').textContent=currentUser?'Account':'Sign in';
  $('#logoutButton').classList.toggle('hidden',!currentUser);
  $('#authForm').classList.toggle('hidden',!client || !!currentUser);
  $('#authConfigNotice').classList.toggle('hidden',!!client);
  $('#profileArea').classList.toggle('hidden',!currentUser);
  $('#adminArea').classList.add('hidden');
  if(currentUser) $('#profileArea').innerHTML=`<h2>Signed in</h2><p>Account: ${esc(currentUser.email)}</p><p class="muted">Your role is checked by database policies. Request publisher access through the school’s approved process.</p>`;
  if(currentUser&&client){
    const [publisherResult,adminResult]=await Promise.all([client.rpc('has_role',{required:'publisher'}),client.rpc('has_role',{required:'administrator'})]);
    const publisher=!!publisherResult.data||!!adminResult.data;
    $('#adminArea').classList.toggle('hidden',!publisher);
    if(publisher)loadManagedContent();
    if(adminResult.data)loadAdminTools();else{$('#roleManager').classList.add('hidden');$('#auditPanel').classList.add('hidden');}
  }
}
async function loadAdminTools(){
  if(!client||!currentUser)return;
  const {data:admin,error}=await client.rpc('has_role',{required:'administrator'});
  if(error||!admin){$('#roleManager').classList.add('hidden');$('#auditPanel').classList.add('hidden');return;}
  $('#roleManager').classList.remove('hidden');$('#auditPanel').classList.remove('hidden');
  try{
    const [{data:profiles,error:pe},{data:roles,error:re},{data:audit,error:ae}]=await Promise.all([
      client.from('profiles').select('id,display_name,created_at,access_status').order('created_at',{ascending:false}),
      client.from('role_assignments').select('user_id,role,assigned_at'),
      client.from('admin_audit').select('actor_id,action,table_name,record_id,occurred_at').order('occurred_at',{ascending:false}).limit(40)
    ]);
    if(pe)throw pe;if(re)throw re;if(ae)throw ae;
    $('#userList').innerHTML=profiles.length?profiles.map(p=>{const assigned=roles.filter(r=>r.user_id===p.id).map(r=>r.role);return `<article class="item"><h3>${esc(p.display_name||'No display name')}</h3><p class="muted">Account reference: ${esc(p.id)} · Status: ${esc(p.access_status)} · Roles: ${esc(assigned.join(', ')||'none assigned')}</p><div class="actions"><button class="button secondary" data-status-id="${esc(p.id)}" data-status="${p.access_status==='active'?'suspended':'active'}">${p.access_status==='active'?'Suspend account':'Restore account'}</button>${['student','publisher','administrator'].map(role=>assigned.includes(role)?`<button class="button secondary" data-role-remove="${esc(p.id)}" data-role="${role}" ${p.id===currentUser.id&&role==='administrator'?'disabled title="Keep another administrator before changing your own role"':''}>Remove ${role}</button>`:`<button class="button secondary" data-role-add="${esc(p.id)}" data-role="${role}">Grant ${role}</button>`).join('')}</div></article>`;}).join(''):'<p class="empty">No accounts yet.</p>';
    $('#auditList').innerHTML=audit.length?audit.map(x=>`<article class="item"><div class="item-meta"><span>${esc(formatDate(x.occurred_at?.slice(0,10)))}</span><span>${esc(x.action)} ${esc(x.table_name)}</span><span>Record ${esc(x.record_id)}</span></div><p class="muted">Actor ${esc(x.actor_id||'system')}</p></article>`).join(''):'<p class="empty">No administrative changes recorded.</p>';
  }catch(e){$('#userList').innerHTML=`<p class="empty">Role administration unavailable: ${esc(e.message)}</p>`;$('#auditList').innerHTML='<p class="empty">Audit data unavailable.</p>';}
}
async function getSupabase(){
  if(!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || SUPABASE_URL.includes('YOUR_') || SUPABASE_PUBLISHABLE_KEY.includes('YOUR_')) return null;
  try { const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2'); return createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}); }
  catch(e){ console.error('Supabase client could not load',e); $('#authConfigNotice').textContent='Could not load the Supabase client. Check your internet connection and setup.'; return null; }
}
async function loadPublicContent(){
  if(!client)return;
  try{
    const [a,e,r]=await Promise.all([client.from('announcements').select('id,title,body,category,published_at,pinned').eq('status','published').order('pinned',{ascending:false}).order('published_at',{ascending:false}),client.from('events').select('id,title,description,event_date,location').eq('status','published').gte('event_date',new Date().toISOString().slice(0,10)).order('event_date'),client.from('resources').select('id,title,description,category,subject,resource_url').eq('is_published',true).order('title')]);
    if(a.error)throw a.error;if(e.error)throw e.error;if(r.error)throw r.error;
    liveAnnouncements=a.data.map(x=>({title:x.title,body:x.body,category:x.category,date:x.published_at?.slice(0,10),pinned:x.pinned,issuer:'School office'}));renderAnnouncements(liveAnnouncements);
    if(e.data.length)renderEvents(e.data.map(x=>({title:x.title,body:x.description,date:x.event_date,location:x.location}))); else renderEvents([]);
    resources.splice(0,resources.length,...r.data.map(x=>({title:x.title,description:x.description,category:x.category,subject:x.subject||'General',url:x.resource_url,isSample:false})));renderResources();
  }catch(e){console.error(e);$('#announcementList').innerHTML='<p class="empty">Announcements could not be loaded. Please try again later.</p>';$('#eventList').innerHTML='<p class="empty">Events could not be loaded. Please try again later.</p>';}
}
async function loadManagedContent(){
  if(!client||!currentUser)return;
  const list=$('#manageList');list.innerHTML='<p class="muted">Loading your authorized content…</p>';
  try{
    const [a,e,r]=await Promise.all([client.from('announcements').select('*').order('updated_at',{ascending:false}),client.from('events').select('*').order('updated_at',{ascending:false}),client.from('resources').select('*').order('updated_at',{ascending:false})]);
    if(a.error)throw a.error;if(e.error)throw e.error;if(r.error)throw r.error;
    const rows=[...(a.data||[]).map(x=>({...x,kind:'announcement'})),...(e.data||[]).map(x=>({...x,kind:'event'}))];
    list.innerHTML=rows.length?rows.map(x=>`<article class="item"><div class="item-meta"><span class="tag">${esc(x.kind)}</span><span>${esc(x.status)}</span><span>${esc(formatDate(x.published_at||x.event_date))}</span></div><h3>${esc(x.title)}</h3><div class="actions"><button class="button secondary" data-edit="${esc(x.id)}" data-kind="${esc(x.kind)}">Edit</button><button class="button secondary" data-toggle="${esc(x.id)}" data-kind="${esc(x.kind)}">${x.status==='published'?'Unpublish':'Publish'}</button><button class="button secondary" data-delete="${esc(x.id)}" data-kind="${esc(x.kind)}">Delete</button></div></article>`).join(''):'<p class="empty">No managed content is available to this account.</p>';
    const resourceList=$('#resourceManageList');if(resourceList)resourceList.innerHTML=r.data.length?r.data.map(x=>`<article class="item"><div class="item-meta"><span class="tag">Resource</span><span>${x.is_published?'Published':'Draft'}</span><span>${esc(x.audience)}</span></div><h3>${esc(x.title)}</h3><p>${esc(x.resource_url)}</p><div class="actions"><button class="button secondary" data-resource-edit="${esc(x.id)}">Edit</button><button class="button secondary" data-resource-toggle="${esc(x.id)}">${x.is_published?'Unpublish':'Publish'}</button><button class="button secondary" data-resource-delete="${esc(x.id)}">Delete</button></div></article>`).join(''):'<p class="empty">No resource links are available to this account.</p>';
  }catch(e){list.innerHTML=`<p class="empty">Content management unavailable: ${esc(e.message)}. Database role policies control access.</p>`;}
}
function beginEditor(kind,row=null){editing=row;$('#contentType').value=kind;$('#contentTitle').value=row?.title||'';$('#contentCategory').value=row?.category||'General';$('#contentDate').value=(row?.published_at||row?.event_date||'').slice(0,10);$('#contentLocation').value=row?.location||'';$('#contentDescription').value=row?.body||row?.description||'';$('#contentPinned').checked=!!row?.pinned;$('#contentStatus').value=row?.status||'draft';$('#editor').classList.remove('hidden');$('#editor').scrollIntoView({behavior:'smooth'});}
function setupResourceAdmin(){
  const button=document.createElement('button');button.type='button';button.className='button secondary';button.id='manageResources';button.textContent='Manage resources';$('#newEvent').after(button);
  const panel=document.createElement('section');panel.id='resourceManager';panel.className='panel hidden';panel.innerHTML='<h3>Resource links</h3><form id="resourceForm"><input id="resourceId" type="hidden"><div class="form-grid"><div class="field"><label for="resourceTitle">Title</label><input id="resourceTitle" maxlength="180" required></div><div class="field"><label for="resourceSubject">Subject</label><input id="resourceSubject" maxlength="80"></div><div class="field"><label for="resourceEditCategory">Category</label><input id="resourceEditCategory" maxlength="60" required></div><div class="field"><label for="resourceUrl">Approved HTTPS URL</label><input id="resourceUrl" type="url" pattern="https://.*" maxlength="2000" required></div></div><div class="field"><label for="resourceDescription">Description</label><textarea id="resourceDescription" maxlength="3000" required></textarea></div><div class="form-grid"><div class="field"><label for="resourceAudience">Audience</label><select id="resourceAudience"><option value="public">Public</option><option value="students">Verified students</option></select></div><label class="inline"><input id="resourcePublished" type="checkbox"><span>Publish resource</span></label></div><p id="resourceStatus" class="status" role="status"></p><button class="button" type="submit">Save resource</button> <button class="button secondary" type="button" id="cancelResource">Cancel</button></form><div id="resourceManageList" class="list"></div>';
  $('#adminArea').append(panel);
}

$('#menuButton').addEventListener('click',()=>{const open=$('#navlinks').classList.toggle('open');$('#menuButton').setAttribute('aria-expanded',String(open));});
$('#navlinks').addEventListener('click',e=>{if(e.target.matches('a')){$('#navlinks').classList.remove('open');$('#menuButton').setAttribute('aria-expanded','false');}});
$('#resourceSearch').addEventListener('input',renderResources);$('#resourceCategory').addEventListener('change',renderResources);$('#announcementSearch').addEventListener('input',()=>renderAnnouncements(liveAnnouncements));$('#announcementCategory').addEventListener('change',()=>renderAnnouncements(liveAnnouncements));
$('#accountButton').addEventListener('click',()=>currentUser?$('#accountPanel').scrollIntoView({behavior:'smooth'}):showAuth());
$('#switchAuth').addEventListener('click',()=>{const signup=$('#accountTitle').textContent!=='Create account';showAuth(signup?'signup':'login');setAuthStatus('');});
$('#authForm').addEventListener('submit',async e=>{e.preventDefault();if(!client)return;const email=$('#authEmail').value.trim(),password=$('#authPassword').value;setAuthStatus('Working…');try{let result;if($('#accountTitle').textContent==='Create account'){if(!$('#termsAccepted').checked)throw new Error('Please accept the Terms of Use and Privacy Notice.');result=await client.auth.signUp({email,password,options:{data:{display_name:$('#displayName').value.trim()||null,terms_accepted:true,accepted_terms_version:'terms-2026-10-17',privacy_notice_version:'privacy-2026-10-17'},emailRedirectTo:location.origin+location.pathname}});if(result.error)throw result.error;setAuthStatus(result.data.session?'Account created. Please check your email for verification.':'Check your email for a verification link.');}else if($('#accountTitle').textContent==='Choose a new password'){result=await client.auth.updateUser({password});if(result.error)throw result.error;setAuthStatus('Password updated. You can continue using your account.');}else{result=await client.auth.signInWithPassword({email,password});if(result.error)throw result.error;setAuthStatus('Signed in.');}}catch(err){setAuthStatus(err.message||'Could not complete the request.',true);}});
$('#resetPassword').addEventListener('click',async()=>{if(!client){setAuthStatus('Configure Supabase to enable password recovery.',true);return;}const email=$('#authEmail').value.trim();if(!email){setAuthStatus('Enter your email address first.',true);return;}const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});setAuthStatus(error?error.message:'If the account exists, a password reset link will be sent.');});
$('#logoutButton').addEventListener('click',async()=>{if(client)await client.auth.signOut();currentUser=null;authUI();});
$('#newNotice').addEventListener('click',()=>beginEditor('announcement'));$('#newEvent').addEventListener('click',()=>beginEditor('event'));$('#cancelEditor').addEventListener('click',()=>$('#editor').classList.add('hidden'));
setupResourceAdmin();
$('#manageResources').addEventListener('click',()=>{$('#resourceManager').classList.toggle('hidden');$('#resourceManager').scrollIntoView({behavior:'smooth',block:'nearest'});});
$('#cancelResource').addEventListener('click',()=>{$('#resourceForm').reset();$('#resourceId').value='';$('#resourceManager').classList.add('hidden');});
$('#resourceForm').addEventListener('submit',async e=>{e.preventDefault();if(!client||!currentUser)return;const id=$('#resourceId').value,url=$('#resourceUrl').value.trim();try{if(new URL(url).protocol!=='https:')throw new Error('Resource links must use HTTPS.');const data={title:$('#resourceTitle').value.trim(),subject:$('#resourceSubject').value.trim()||null,category:$('#resourceEditCategory').value.trim(),resource_url:url,description:$('#resourceDescription').value.trim(),audience:$('#resourceAudience').value,is_published:$('#resourcePublished').checked,updated_by:currentUser.id};const query=id?client.from('resources').update(data).eq('id',id):client.from('resources').insert({...data,created_by:currentUser.id});const {error}=await query;if(error)throw error;$('#resourceStatus').textContent='Resource saved.';$('#resourceStatus').classList.remove('error');$('#resourceForm').reset();$('#resourceId').value='';await loadManagedContent();await loadPublicContent();}catch(err){$('#resourceStatus').textContent=err.message||'Could not save resource.';$('#resourceStatus').classList.add('error');}});
$('#resourceManageList').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||!client)return;try{if(b.dataset.resourceEdit){const {data,error}=await client.from('resources').select('*').eq('id',b.dataset.resourceEdit).single();if(error)throw error;$('#resourceId').value=data.id;$('#resourceTitle').value=data.title;$('#resourceSubject').value=data.subject||'';$('#resourceEditCategory').value=data.category;$('#resourceUrl').value=data.resource_url;$('#resourceDescription').value=data.description;$('#resourceAudience').value=data.audience;$('#resourcePublished').checked=data.is_published;$('#resourceManager').classList.remove('hidden');$('#resourceForm').scrollIntoView({behavior:'smooth'});}else if(b.dataset.resourceToggle){const {data,error}=await client.from('resources').select('is_published').eq('id',b.dataset.resourceToggle).single();if(error)throw error;const {error:updateError}=await client.from('resources').update({is_published:!data.is_published,updated_by:currentUser.id}).eq('id',b.dataset.resourceToggle);if(updateError)throw updateError;await loadManagedContent();await loadPublicContent();}else if(b.dataset.resourceDelete){contentToDelete={id:b.dataset.resourceDelete,table:'resources'};$('#confirmDialog').showModal();}}catch(err){$('#resourceManageList').insertAdjacentHTML('afterbegin',`<p class="status error">${esc(err.message)}</p>`);}});
$('#contentForm').addEventListener('submit',async e=>{e.preventDefault();if(!client||!currentUser)return;const kind=$('#contentType').value;const base={title:$('#contentTitle').value.trim(),category:$('#contentCategory').value.trim(),status:$('#contentStatus').value};const data=kind==='announcement'?{...base,body:$('#contentDescription').value.trim(),published_at:$('#contentDate').value,pinned:$('#contentPinned').checked}:{...base,description:$('#contentDescription').value.trim(),event_date:$('#contentDate').value,location:$('#contentLocation').value.trim()||null};setEditorStatus('Saving…');try{const table=kind==='announcement'?'announcements':'events';const query=editing?client.from(table).update({...data,updated_by:currentUser.id}).eq('id',editing.id):client.from(table).insert({...data,created_by:currentUser.id,updated_by:currentUser.id});const {error}=await query;if(error)throw error;setEditorStatus('Saved.');editing=null;await loadManagedContent();await loadPublicContent();}catch(err){setEditorStatus(err.message||'Could not save. Check publisher access.',true);}});
$('#manageList').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||!client)return;const kind=b.dataset.kind,table=kind==='announcement'?'announcements':'events',id=b.dataset.edit||b.dataset.toggle||b.dataset.delete;try{if(b.dataset.edit){const {data,error}=await client.from(table).select('*').eq('id',id).single();if(error)throw error;beginEditor(kind,data);}else if(b.dataset.toggle){const {data,error}=await client.from(table).select('status').eq('id',id).single();if(error)throw error;const {error:updateError}=await client.from(table).update({status:data.status==='published'?'draft':'published'}).eq('id',id);if(updateError)throw updateError;await loadManagedContent();await loadPublicContent();}else if(b.dataset.delete){contentToDelete={id,table};$('#confirmDialog').showModal();}}catch(err){$('#manageList').insertAdjacentHTML('afterbegin',`<p class="status error">${esc(err.message)}</p>`);}});
$('#userList').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||!client)return;const action=b.dataset.roleAdd?'grant role':b.dataset.roleRemove?'remove role':b.dataset.statusId?`${b.dataset.status} this account`:'';if(action&&!window.confirm(`Confirm: ${action}?`))return;try{let result;if(b.dataset.roleAdd)result=await client.from('role_assignments').insert({user_id:b.dataset.roleAdd,role:b.dataset.role,assigned_by:currentUser.id});else if(b.dataset.roleRemove)result=await client.from('role_assignments').delete().eq('user_id',b.dataset.roleRemove).eq('role',b.dataset.role);else if(b.dataset.statusId)result=await client.from('profiles').update({access_status:b.dataset.status}).eq('id',b.dataset.statusId);if(result?.error)throw result.error;await loadAdminTools();}catch(err){$('#userList').insertAdjacentHTML('afterbegin',`<p class="status error">${esc(err.message)}</p>`);}});
$('#keepItem').addEventListener('click',()=>$('#confirmDialog').close());$('#deleteItem').addEventListener('click',async()=>{if(!contentToDelete)return;const {error}=await client.from(contentToDelete.table).delete().eq('id',contentToDelete.id);$('#confirmDialog').close();contentToDelete=null;if(error)$('#manageList').insertAdjacentHTML('afterbegin',`<p class="status error">${esc(error.message)}</p>`);else{await loadManagedContent();await loadPublicContent();}});

renderAnnouncements();renderResources();renderEvents();
client=await getSupabase();
if(client){const {data:{session}}=await client.auth.getSession();currentUser=session?.user||null;client.auth.onAuthStateChange((event,session)=>{currentUser=session?.user||null;setTimeout(async()=>{await authUI();if(currentUser)loadPublicContent();if(event==='PASSWORD_RECOVERY') {$('#accountPanel').classList.remove('hidden');$('#authForm').classList.remove('hidden');$('#accountTitle').textContent='Choose a new password';$('#authSubmit').textContent='Update password';$('#switchAuth').classList.add('hidden');$('#resetPassword').classList.add('hidden');$('#authEmail').closest('.field').classList.add('hidden');$('#accountPanel').scrollIntoView({behavior:'smooth'});}},0);});await authUI();await loadPublicContent();}
else await authUI();

