(()=>{
'use strict';
const $=id=>document.getElementById(id);
const toast=(message)=>{const el=$('toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2600)};
const titles={home:'خانه',messages:'پیام‌ها',create:'انتشار محتوا',reels:'ویدئوها',explore:'کشف و جست‌وجو',notifications:'اعلان‌ها',profile:'پروفایل من',settings:'تنظیمات'};
let currentPage='home',selectedFile=null,currentUser=null,pendingOtp=null,storiesCache=[],currentChatId=null,replyToMessageId=null,chatsCache=[];
function go(page){
 if(!titles[page])return;
 currentPage=page;
 document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.dataset.view===page));
 document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
 $('pageTitle').textContent=titles[page];
 if(page==='create')$('postText').focus({preventScroll:true});
 if(currentUser){if(page==='home'){loadFeed();loadStories()}if(page==='messages')loadChats();if(page==='explore')$('exploreSearch').focus({preventScroll:true});if(page==='notifications')loadNotifications();if(page==='profile')loadProfile()}
 window.scrollTo({top:0,behavior:'smooth'});
}
async function requestJson(url,body){
 const response=await fetch(url,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.ok===false)throw new Error(data.error||'درخواست انجام نشد.');
 return data;
}
function normalizeDigits(value){return String(value||'').replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))}
function normalizePhone(value){return normalizeDigits(value).replace(/[\s()-]/g,'').replace(/^\+?98/,'0')}
function usernameValid(value){return /^[a-z][a-z0-9_]{3,29}$/.test(value)}
function setAuthError(message){$('authError').textContent=message||''}
function authOpen(){
 $('authOverlay').classList.add('open');$('authOverlay').setAttribute('aria-hidden','false');setAuthError('');
 if(pendingOtp&&pendingOtp.expiresAt>Date.now())showCodeStep();else showPhoneStep();
}
function authClose(){$('authOverlay').classList.remove('open');$('authOverlay').setAttribute('aria-hidden','true')}
function showPhoneStep(){$('phoneStep').hidden=false;$('codeStep').hidden=true;$('authTitle').textContent='ساخت حساب یا ورود';$('authDescription').textContent='شماره موبایل در این نسخه فقط شناسه حساب است؛ اعلان همین دستگاه کد را دریافت می‌کند.'}
function showCodeStep(){$('phoneStep').hidden=true;$('codeStep').hidden=false;$('authTitle').textContent='تأیید دستگاه';$('authDescription').textContent='کد شش‌رقمی را از اعلان همین دستگاه وارد کن. این کد مالکیت سیم‌کارت را اثبات نمی‌کند.';$('otpHelp').textContent='کد برای '+(pendingOtp?.phone||'شماره واردشده')+' ارسال شده و پس از پایان اعتبار قابل استفاده نیست.';$('authCode').focus()}
function base64UrlToBytes(value){const normalized=value.replace(/-/g,'+').replace(/_/g,'/');const padded=normalized+'='.repeat((4-normalized.length%4)%4);const raw=atob(padded);return Uint8Array.from(raw,c=>c.charCodeAt(0))}
async function sendOtp(){
 const phone=normalizePhone($('authPhone').value),name=$('authName').value.trim(),username=$('authUsername').value.trim().toLowerCase();
 if(!/^09\\d{9}$/.test(phone))return setAuthError('شماره موبایل معتبر ایران وارد کن.');
 if(name.length<2)return setAuthError('نام نمایشی باید دست‌کم دو نویسه باشد.');
 if(!usernameValid(username))return setAuthError('نام کاربری باید ۴ تا ۳۰ نویسه و با حرف انگلیسی شروع شود.');
 if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))return setAuthError('این مرورگر از اعلان لازم برای دریافت کد پشتیبانی نمی‌کند.');
 $('sendOtp').disabled=true;$('sendOtp').textContent='در حال ارسال…';setAuthError('');
 try{
  const config=await requestJson('/api/otp/config');
  const registration=await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let permission=Notification.permission;
  if(permission!=='granted')permission=await Notification.requestPermission();
  if(permission!=='granted')throw new Error('برای دریافت کد ورود، اجازه اعلان همین دستگاه لازم است.');
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlToBytes(config.vapidPublicKey)});
  await requestJson('/api/otp/subscribe',{phone,subscription:subscription.toJSON()});
  const result=await requestJson('/api/otp/send',{phone});
  pendingOtp={phone,name,username,requestId:result.requestId,expiresAt:Date.now()+Math.min(Number(result.expiresIn)||120,120)*1000};
  sessionStorage.setItem('vivo_v2_pending_otp',JSON.stringify(pendingOtp));$('authCode').value='';showCodeStep();
 }catch(error){setAuthError(error.message||'ارسال کد انجام نشد.')}
 finally{$('sendOtp').disabled=false;$('sendOtp').textContent='دریافت کد تأیید'}
}
async function verifyOtp(){
 const code=normalizeDigits($('authCode').value).replace(/\D/g,'').slice(0,6);
 if(!pendingOtp||pendingOtp.expiresAt<=Date.now())return setAuthError('مهلت این کد تمام شده است؛ درخواست تازه ثبت کن.');
 if(!/^\d{6}$/.test(code))return setAuthError('کد باید دقیقاً شش رقم باشد.');
 $('verifyOtp').disabled=true;$('verifyOtp').textContent='در حال بررسی…';setAuthError('');
 try{
  const issued=await requestJson('/api/vivo/session',{phone:pendingOtp.phone,name:pendingOtp.name,username:pendingOtp.username,requestId:pendingOtp.requestId,code});
  currentUser=issued.user;
  const profile=await requestJson('/api/vivo/profile');if(profile.user)currentUser=profile.user;
  sessionStorage.removeItem('vivo_v2_pending_otp');pendingOtp=null;
  updateUser(currentUser);authClose();toast('کد دستگاه پذیرفته شد و نشست حساب ایجاد شد.');
  await loadHomeData();
 }catch(error){setAuthError(error.message||'تأیید حساب انجام نشد.')}
 finally{$('verifyOtp').disabled=false;$('verifyOtp').textContent='تأیید و ورود'}
}
function updateUser(user){
 currentUser=user||null;
 const login=$('loginButton');
 if(login){login.textContent=currentUser?'خروج':'ورود / ثبت‌نام';login.dataset.action=currentUser?'logout':'login'}
 const publish=$('publishButton');if(publish)publish.disabled=!currentUser||!$('postText').value.trim()||!!selectedFile;
 if(!currentUser)return;
 const name=currentUser.display_name||'کاربر ویوو',username=currentUser.username||'';
 const mini=document.querySelector('.account-mini');
 if(mini){const b=mini.querySelector('b'),small=mini.querySelector('small');if(b)b.textContent=name;if(small)small.textContent=username?'@'+username:'حساب تأییدشده'}
 const profileButton=document.querySelector('.profile-button');
 if(profileButton){const spans=profileButton.querySelectorAll('span');if(spans[1])spans[1].textContent=name}
 const title=document.querySelector('.profile-identity h2'),handle=document.querySelector('.profile-identity span'),bio=document.querySelector('.profile-identity p');
 if(title)title.textContent=name;if(handle)handle.textContent=username?'@'+username:'نام کاربری ثبت نشده';if(bio)bio.textContent=currentUser.bio||'پروفایل ویوو تو؛ می‌توانی بعداً توضیحاتت را تکمیل کنی.';
 document.querySelectorAll('.avatar-self').forEach(el=>{el.textContent=name.trim().slice(0,1)||'و'});
 const profileAvatar=document.querySelector('.profile-avatar');if(profileAvatar)profileAvatar.textContent=name.trim().slice(0,1)||'و';
}
async function checkSession(){
 try{const result=await requestJson('/api/vivo/profile');if(result.user){updateUser(result.user);await loadHomeData()}}
 catch{updateUser(null)}
}
async function logout(){
 try{await requestJson('/api/vivo/logout',{})}catch(error){toast(error.message)}
 updateUser(null);$('postsList').replaceChildren();$('notificationList').replaceChildren();$('searchResults').replaceChildren();$('profilePosts').replaceChildren();storiesCache=[];chatsCache=[];currentChatId=null;$('chatList').replaceChildren();$('chatMessages').replaceChildren();$('chatWindow').hidden=true;$('chatPlaceholder').hidden=false;document.querySelector('.messages-shell').classList.remove('has-chat');document.querySelectorAll('.real-story').forEach(el=>el.remove());document.querySelector('.feed-empty').hidden=false;$('notificationsEmpty').hidden=false;$('profileEmpty').hidden=false;toast('از حساب ویوو خارج شدی.');
}
async function openProfileEditor(){
 if(!currentUser){authOpen();return}
 try{
  const result=await requestJson('/api/vivo/profile');
  const user=result.user||currentUser;
  $('profileName').value=user.display_name||'';
  $('profileUsername').value=user.username||'';
  $('profileBio').value=user.bio||'';
  $('profilePrivate').checked=!!user.is_private;
  $('profileEditorError').textContent='';
  $('profileEditor').hidden=false;$('profileEditor').classList.add('open');
  $('profileName').focus();
 }catch(error){toast(error.message)}
}
function closeProfileEditor(){$('profileEditor').classList.remove('open');$('profileEditor').hidden=true}
async function saveProfile(){
 if(!currentUser){authOpen();return}
 const name=$('profileName').value.trim(),username=$('profileUsername').value.trim().toLowerCase(),bio=$('profileBio').value;
 if(name.length<2){$('profileEditorError').textContent='نام نمایشی باید دست‌کم دو نویسه باشد.';return}
 if(!usernameValid(username)){$('profileEditorError').textContent='نام کاربری معتبر نیست.';return}
 const button=$('saveProfileButton');button.disabled=true;button.textContent='در حال ذخیره…';
 try{
  const result=await requestJson('/api/vivo/profile',{name,username,bio,isPrivate:$('profilePrivate').checked});
  currentUser=result.user;updateUser(currentUser);closeProfileEditor();toast('پروفایل با موفقیت ذخیره شد.');await loadProfile();
 }catch(error){$('profileEditorError').textContent=error.message||'ذخیره پروفایل ناموفق بود.'}
 finally{button.disabled=false;button.textContent='ذخیره تغییرات'}
}
function formatTime(value){
 const d=new Date(value);if(Number.isNaN(d.getTime()))return '';
 return new Intl.DateTimeFormat('fa-IR',{dateStyle:'short',timeStyle:'short'}).format(d);
}
function node(tag,className,text){
 const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;
}
function renderPosts(posts,target,empty){
 target.replaceChildren();
 empty.hidden=posts.length>0;
 for(const post of posts){
  const card=node('article','post-card');card.dataset.postId=post.id;
  const head=node('div','post-head');
  const avatar=node('span','avatar',post.author?.display_name?.slice(0,1)||'و');
  const author=node('div','post-author');
  author.append(node('b','',post.author?.display_name||'کاربر ویوو'),node('small','',post.author?.username?'@'+post.author.username:'عضو ویوو'));
  head.append(avatar,author,node('time','post-time',formatTime(post.createdAt)));card.append(head);
  if(post.body)card.append(node('p','post-body',post.body));
  if(post.media?.length)card.append(node('div','post-media-note','نمایش رسانه پس از اتصال لینک امن فایل فعال می‌شود.'));
  const actions=node('div','post-actions');
  const like=node('button','post-action'+(post.liked?' liked':''),(post.liked?'♥ ':'♡ ')+String(post.likes||0));like.dataset.action='like';like.dataset.postId=post.id;
  const comments=node('button','post-action','نظرها · '+String(post.comments||0));comments.dataset.action='toggle-comments';comments.dataset.postId=post.id;
  actions.append(like,comments);card.append(actions);
  const panel=node('div','post-comments');panel.id='comments-'+post.id;
  const list=node('div','comments-list');list.id='comments-list-'+post.id;
  const compose=node('div','comment-compose');
  const input=node('input');input.type='text';input.maxLength=1000;input.placeholder='دیدگاه خود را بنویس…';input.id='comment-input-'+post.id;
  const send=node('button','','ارسال');send.dataset.action='send-comment';send.dataset.postId=post.id;
  compose.append(input,send);panel.append(list,compose);card.append(panel);target.append(card);
 }
}
async function loadFeed(){
 if(!currentUser)return;
 try{
  const result=await requestJson('/api/vivo/social/feed');
  renderPosts(result.posts||[],$('postsList'),document.querySelector('.feed-empty'));
 }catch(error){toast(error.message)}
}
async function loadComments(postId){
 const result=await requestJson('/api/vivo/social/comments?postId='+encodeURIComponent(postId));
 const list=$('comments-list-'+postId);if(!list)return;list.replaceChildren();
 for(const comment of result.comments||[]){
  const row=node('div','comment-row');const avatar=node('span','avatar',comment.author?.display_name?.slice(0,1)||'و');
  const copy=node('div');copy.append(node('b','',comment.author?.display_name||'کاربر ویوو'),node('p','',comment.body));row.append(avatar,copy);list.append(row);
 }
 if(!result.comments?.length)list.append(node('small','auth-hint','هنوز دیدگاهی ثبت نشده است.'));
}
async function loadStories(){
 if(!currentUser)return;
 try{
  const result=await requestJson('/api/vivo/social/stories');storiesCache=result.stories||[];
  const track=document.querySelector('.stories-track');track.querySelectorAll('.real-story').forEach(el=>el.remove());
  const note=track.querySelector('.story-empty-note');if(note)note.hidden=storiesCache.length>0;
  track.classList.toggle('has-stories',storiesCache.length>0);
  for(const story of storiesCache){
   const item=node('button','story-item real-story');item.dataset.action='open-story';item.dataset.storyId=story.id;
   const ring=node('span','story-ring');ring.append(node('span','avatar',story.author?.display_name?.slice(0,1)||'و'));
   item.append(ring,node('b','',story.author?.display_name||'کاربر'),node('small','',story.body||'استوری تازه'));track.append(item);
  }
 }catch(error){toast(error.message)}
}
function openStory(storyId){
 const story=storiesCache.find(x=>x.id===storyId);if(!story)return;
 let viewer=$('storyViewer');
 if(!viewer){viewer=node('div','story-viewer');viewer.id='storyViewer';viewer.innerHTML='<div class="story-viewer-card"><button class="story-viewer-close" id="storyViewerClose">×</button><div class="story-viewer-progress"></div><div class="story-viewer-author" id="storyViewerAuthor"></div><div class="story-viewer-body" id="storyViewerBody"></div><div class="story-viewer-time" id="storyViewerTime"></div></div>';document.body.append(viewer);$('storyViewerClose').addEventListener('click',()=>viewer.classList.remove('open'))}
 $('storyViewerAuthor').textContent=story.author?.display_name||'کاربر ویوو';
 $('storyViewerBody').textContent=story.body||'';
 $('storyViewerTime').textContent=formatTime(story.createdAt);
 viewer.classList.add('open');
 requestJson('/api/vivo/social/stories/view',{storyId}).catch(()=>{});
}
async function publishStory(){
 if(!currentUser){authOpen();return}
 const text=$('storyText').value.trim();if(!text){toast('متن استوری را وارد کن.');return}
 try{await requestJson('/api/vivo/social/stories',{text,mediaType:'text',background:'blue',audience:$('storyAudience').value});$('storyText').value='';$('storyComposer').classList.remove('open');$('storyComposer').hidden=true;toast('استوری در حساب ابری ذخیره شد.');await loadStories()}catch(error){toast(error.message)}
}
async function publishPost(){
 if(!currentUser){authOpen();return}
 const text=$('postText').value.trim();
 if(!text&&!selectedFile){toast('متن پست را وارد کن.');return}
 if(selectedFile){toast('بارگذاری رسانه هنوز به فضای ذخیره‌سازی امن متصل نشده؛ فعلاً پست متنی منتشر کن.');return}
 const button=$('publishButton');button.disabled=true;button.textContent='در حال انتشار…';
 try{
  await requestJson('/api/vivo/social/posts',{text,media:[],audience:$('postAudience').value});
  $('postText').value='';button.textContent='انتشار پست';button.disabled=true;
  $('composerStatus').textContent='پست در پایگاه داده ویوو ثبت شد.';
  toast('پست در حساب ابری ذخیره شد.');go('home');
 }catch(error){toast(error.message)}
 finally{button.textContent='انتشار پست';button.disabled=!currentUser||!$('postText').value.trim()||!!selectedFile}
}
async function searchUsers(){
 const q=$('exploreSearch').value.trim();if(q.length<2){toast('برای جست‌وجو دست‌کم دو نویسه وارد کن.');return}
 if(!currentUser){authOpen();return}
 try{
  const result=await requestJson('/api/vivo/social/search?q='+encodeURIComponent(q));
  const target=$('searchResults');target.replaceChildren();$('exploreEmpty').hidden=(result.users||[]).length>0;
  for(const user of result.users||[]){
   const card=node('article','result-card');card.append(node('span','avatar',user.display_name?.slice(0,1)||'و'));
   const info=node('div','result-info');info.append(node('b','',user.display_name||'کاربر'),node('small','',user.username?'@'+user.username:''),node('p','',user.bio||''));
   card.append(info);
   if(user.id!==currentUser.id){const follow=node('button','secondary-button',user.is_private?'درخواست دنبال‌کردن':'دنبال‌کردن');follow.dataset.action='follow';follow.dataset.username=user.username;card.append(follow)}
   target.append(card);
  }
 }catch(error){toast(error.message)}
}
async function loadNotifications(){
 if(!currentUser)return;
 try{
  const result=await requestJson('/api/vivo/social/notifications');const list=$('notificationList');list.replaceChildren();
  const items=result.notifications||[];$('notificationsEmpty').hidden=items.length>0;
  const labels={follow:'درخواست یا دنبال‌کننده جدید',like:'پستت را پسندید',comment:'برای پستت دیدگاه نوشت',reply:'به گفت‌وگوی تو پاسخ داد',mention:'تو را نام برد',story_reaction:'به استوری تو واکنش نشان داد',group_invite:'دعوت گروهی',message:'پیام جدید',system:'پیام سیستمی'};
  for(const item of items){
   const card=node('article','notification-card'+(item.read_at?'':' unread'));
   card.append(node('span','avatar',item.actor?.display_name?.slice(0,1)||'V'));
   const copy=node('div','notification-copy');copy.append(node('p','',(item.actor?.display_name||'VIVO')+' '+(labels[item.kind]||'فعالیت تازه')),node('small','',formatTime(item.created_at)));
   card.append(copy);
   if(!item.read_at){const mark=node('button','text-button','خواندم');mark.dataset.action='mark-notification';mark.dataset.notificationId=item.id;card.append(mark)}
   list.append(card);
  }
 }catch(error){toast(error.message)}
}
async function loadProfile(){
 if(!currentUser?.username)return;
 try{
  const result=await requestJson('/api/vivo/social/profile/'+encodeURIComponent(currentUser.username));
  const p=result.profile;
  const stats=document.querySelectorAll('.profile-stats b');if(stats[0])stats[0].textContent=String(p.postsCount);if(stats[1])stats[1].textContent=String(p.followersCount);if(stats[2])stats[2].textContent=String(p.followingCount);
  renderPosts(result.posts||[],$('profilePosts'),$('profileEmpty'));
 }catch(error){toast(error.message)}
}
async function loadHomeData(){await Promise.all([loadFeed(),loadStories(),loadNotifications(),loadProfile(),loadChats()])}

async function loadChats(){
 if(!currentUser)return;
 try{
  const result=await requestJson('/api/vivo/chat/list');chatsCache=result.chats||[];
  const list=$('chatList');list.replaceChildren();$('conversationEmpty').hidden=chatsCache.length>0;
  for(const chat of chatsCache){
   const row=node('button','conversation-row'+(chat.id===currentChatId?' active':''));row.dataset.action='open-chat';row.dataset.chatId=chat.id;
   const participant=chat.participants?.[0];
   row.append(node('span','avatar',participant?.display_name?.slice(0,1)||chat.name?.slice(0,1)||'V'));
   const copy=node('span','conversation-row-copy');copy.append(node('b','',chat.name||'گفت‌وگو'),node('small','',chat.lastMessage?.text|| (chat.type==='group'?'گروه ویوو':'گفت‌وگوی خصوصی')));
   const meta=node('span','conversation-row-meta');meta.append(node('small','',chat.lastMessage?formatTime(chat.lastMessage.sentAt):''));if(chat.unread)meta.append(node('span','unread-badge',String(chat.unread)));
   row.append(copy,meta);list.append(row);
  }
 }catch(error){toast(error.message)}
}
async function openChat(chatId){
 const chat=chatsCache.find(x=>x.id===chatId);if(!chat)return;
 currentChatId=chatId;replyToMessageId=null;
 document.querySelector('.messages-shell').classList.add('has-chat');
 $('chatPlaceholder').hidden=true;$('chatWindow').hidden=false;
 $('chatTitle').textContent=chat.name;$('chatSubtitle').textContent=chat.type==='group'?'گروه · '+(chat.participants?.length||0)+' عضو':'گفت‌وگوی خصوصی';
 $('chatMessageInput').placeholder='پیامت را بنویس…';
 await loadChatMessages();
 document.querySelectorAll('.conversation-row').forEach(row=>row.classList.toggle('active',row.dataset.chatId===chatId));
}
async function loadChatMessages(){
 if(!currentChatId)return;
 try{
  const result=await requestJson('/api/vivo/chat/messages?chatId='+encodeURIComponent(currentChatId));
  const list=$('chatMessages');list.replaceChildren();
  for(const message of result.messages||[]){
   const bubble=node('article','message-bubble'+(message.fromMe?' mine':''));
   if(!message.fromMe)bubble.append(node('span','message-sender',message.sender?.display_name||'کاربر'));
   bubble.append(node('p','',message.text||'پیوست'));
   bubble.append(node('time','',formatTime(message.sentAt)+(message.editedAt?' · ویرایش‌شده':'')));
   const controls=node('div','message-controls');
   const reply=node('button','text-button','پاسخ');reply.dataset.action='reply-message';reply.dataset.messageId=message.id;controls.append(reply);
   for(const reaction of message.reactions||[]){const chip=node('button','text-button reaction-chip',reaction.reaction+' '+reaction.count);chip.dataset.action='react-message';chip.dataset.messageId=message.id;chip.dataset.reaction=reaction.reaction;if(reaction.mine)chip.classList.add('active');controls.append(chip)}
   const react=node('button','text-button','＋ واکنش');react.dataset.action='react-message';react.dataset.messageId=message.id;controls.append(react);
   if(message.fromMe){const edit=node('button','text-button','ویرایش');edit.dataset.action='edit-message';edit.dataset.messageId=message.id;controls.append(edit);const del=node('button','text-button','حذف');del.dataset.action='delete-message';del.dataset.messageId=message.id;controls.append(del)}
   bubble.append(controls);list.append(bubble);
  }
  list.scrollTop=list.scrollHeight;
  await requestJson('/api/vivo/chat/read',{chatId:currentChatId});
  await loadChats();
 }catch(error){toast(error.message)}
}
async function sendChatMessage(){
 if(!currentUser){authOpen();return}
 if(!currentChatId)return;
 const input=$('chatMessageInput'),text=input.value.trim();if(!text)return;
 const button=document.querySelector('[data-action="send-chat-message"]');button.disabled=true;
 try{await requestJson('/api/vivo/chat/send',{chatId:currentChatId,text,replyTo:replyToMessageId});input.value='';replyToMessageId=null;input.placeholder='پیامت را بنویس…';await loadChatMessages()}
 catch(error){toast(error.message)}
 finally{button.disabled=false}
}
async function createPrivateChat(){
 const username=$('chatTargetUsername').value.trim().toLowerCase();if(!username){$('chatComposerError').textContent='نام کاربری را وارد کن.';return}
 try{const result=await requestJson('/api/vivo/chat/create',{type:'private',username});$('chatComposer').classList.remove('open');$('chatComposer').hidden=true;$('chatComposerError').textContent='';await loadChats();await openChat(result.chat.id)}
 catch(error){$('chatComposerError').textContent=error.message}
}
async function createGroupChat(){
 const name=$('newGroupName').value.trim(),usernames=$('newGroupMembers').value.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(!name||!usernames.length){$('chatComposerError').textContent='نام گروه و نام کاربری اعضا را وارد کن.';return}
 try{const result=await requestJson('/api/vivo/chat/create',{type:'group',name,usernames});$('chatComposer').classList.remove('open');$('chatComposer').hidden=true;$('chatComposerError').textContent='';await loadChats();await openChat(result.chat.id)}
 catch(error){$('chatComposerError').textContent=error.message}
}

function showFile(file){
 selectedFile=file;const preview=$('filePreview');preview.hidden=!file;preview.replaceChildren();
 if(!file)return;
 const label=node('div','',file.name+' · '+Math.ceil(file.size/1024)+' کیلوبایت');preview.append(label);
 if(file.type.startsWith('image/')||file.type.startsWith('video/')){
  const url=URL.createObjectURL(file),media=document.createElement(file.type.startsWith('image/')?'img':'video');
  media.src=url;if(media.tagName==='VIDEO'){media.controls=true;media.playsInline=true}preview.append(media);
 }
}
document.addEventListener('click',async event=>{
 const pageButton=event.target.closest('[data-page]');
 if(pageButton){event.preventDefault();go(pageButton.dataset.page);return}
 const actionButton=event.target.closest('[data-action]');if(!actionButton)return;
 const action=actionButton.dataset.action,postId=actionButton.dataset.postId;
 if(action==='open-chat'){openChat(actionButton.dataset.chatId);return}
 if(action==='reply-message'){
  replyToMessageId=actionButton.dataset.messageId;
  const preview=actionButton.closest('.message-bubble')?.querySelector('p')?.textContent||'پیام';
  $('chatMessageInput').placeholder='پاسخ به: '+preview.slice(0,45);
  $('chatMessageInput').focus();return;
 }
 if(action==='react-message'){
  try{await requestJson('/api/vivo/chat/react',{messageId:actionButton.dataset.messageId,reaction:actionButton.dataset.reaction||'👍'});await loadChatMessages();toast('واکنش ثبت شد.')}
  catch(error){toast(error.message)}return;
 }
 if(action==='edit-message'){
  const bubble=actionButton.closest('.message-bubble'),oldText=bubble?.querySelector('p')?.textContent||'';
  const updated=window.prompt('متن ویرایش‌شده پیام:',oldText);
  if(updated===null||!updated.trim()||updated.trim()===oldText)return;
  try{await requestJson('/api/vivo/chat/edit',{messageId:actionButton.dataset.messageId,text:updated.trim()});await loadChatMessages();toast('پیام ویرایش شد.')}
  catch(error){toast(error.message)}return;
 }
 if(action==='delete-message'){
  if(!window.confirm('این پیام حذف شود؟'))return;
  try{await requestJson('/api/vivo/chat/delete',{messageId:actionButton.dataset.messageId});await loadChatMessages();toast('پیام حذف شد.')}
  catch(error){toast(error.message)}return;
 }
 if(action==='login'){authOpen();return}
 if(action==='logout'){logout();return}
 if(action==='choose-file'){$('postFile').click();return}
 if(action==='publish'){publishPost();return}
 if(action==='like'){
  if(!currentUser){authOpen();return}
  try{await requestJson('/api/vivo/social/like',{postId});await loadFeed();if(currentPage==='profile')await loadProfile()}catch(error){toast(error.message)}return;
 }
 if(action==='toggle-comments'){
  const panel=$('comments-'+postId);if(!panel)return;panel.classList.toggle('open');
  if(panel.classList.contains('open'))loadComments(postId).catch(error=>toast(error.message));return;
 }
 if(action==='send-comment'){
  const input=$('comment-input-'+postId),text=input.value.trim();if(!text)return;
  try{await requestJson('/api/vivo/social/comment',{postId,text});input.value='';await loadComments(postId);await loadFeed()}catch(error){toast(error.message)}return;
 }
 if(action==='follow'){
  try{const result=await requestJson('/api/vivo/social/follow',{username:actionButton.dataset.username});actionButton.textContent=result.status==='pending'?'درخواست ارسال شد':'دنبال می‌کنی';actionButton.disabled=true}catch(error){toast(error.message)}return;
 }
 if(action==='mark-notification'){
  try{await requestJson('/api/vivo/social/notifications/read',{id:actionButton.dataset.notificationId});await loadNotifications()}catch(error){toast(error.message)}return;
 }
 if(action==='open-story'){openStory(actionButton.dataset.storyId);return}
 if(action==='story'){if(!currentUser){authOpen();return}$('storyComposer').hidden=false;$('storyComposer').classList.add('open');$('storyText').focus();return}
 if(action==='close-story-composer'){$('storyComposer').classList.remove('open');$('storyComposer').hidden=true;return}
 if(action==='publish-story'){publishStory();return}
 if(action==='new-chat'){
  if(!currentUser){authOpen();return}
  $('chatComposer').hidden=false;$('chatComposer').classList.add('open');$('chatTargetUsername').focus();return;
 }
 if(action==='close-chat-composer'){$('chatComposer').classList.remove('open');$('chatComposer').hidden=true;return}
 if(action==='create-private-chat'){createPrivateChat();return}
 if(action==='create-group-chat'){createGroupChat();return}
 if(action==='send-chat-message'){sendChatMessage();return}
 if(action==='chat-back'){
  currentChatId=null;$('chatWindow').hidden=true;$('chatPlaceholder').hidden=false;
  document.querySelector('.messages-shell').classList.remove('has-chat');
  document.querySelectorAll('.conversation-row').forEach(row=>row.classList.remove('active'));
  return;
 }
 if(action==='refresh-chat'){loadChatMessages();return}
 if(action==='mute-chat'){
  if(!currentChatId)return;
  const chat=chatsCache.find(item=>item.id===currentChatId);
  const muted=!chat?.muted;
  actionButton.disabled=true;
  try{
   const result=await requestJson('/api/vivo/chat/mute',{chatId:currentChatId,muted});
   if(chat)chat.muted=result.muted;
   actionButton.title=result.muted?'فعال‌کردن اعلان‌های گفتگو':'بی‌صداکردن گفتگو';
   actionButton.setAttribute('aria-label',actionButton.title);
   toast(result.muted?'گفتگو بی‌صدا شد.':'اعلان‌های گفتگو فعال شد.');
  }catch(error){toast(error.message)}
  finally{actionButton.disabled=false}
  return;
 }
 if(action==='search'){searchUsers();return}
 if(action==='feed-filter'){toast('فیلترهای فید در مرحله بعد اضافه می‌شوند.');return}
 if(action==='edit-profile'||action==='account'||action==='privacy'){openProfileEditor();return}
 if(action==='close-profile-editor'){closeProfileEditor();return}
 if(action==='save-profile'){saveProfile();return}
 if(action==='notifications'||action==='notification-settings'){if(!currentUser){authOpen();return}go('notifications');loadNotifications();return}
 if(action==='security'||action==='appearance'||action==='support'){toast('این بخش هنوز آماده نیست؛ هیچ تنظیمی تغییر نکرده است.');return}
});
$('authClose').addEventListener('click',authClose);
$('chatComposer').addEventListener('click',event=>{if(event.target===$('chatComposer')){$('chatComposer').classList.remove('open');$('chatComposer').hidden=true}});
$('chatMessageInput').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage()}});
$('storyComposer').addEventListener('click',event=>{if(event.target===$('storyComposer')){$('storyComposer').classList.remove('open');$('storyComposer').hidden=true}});
$('authOverlay').addEventListener('click',event=>{if(event.target===$('authOverlay'))authClose()});
$('sendOtp').addEventListener('click',sendOtp);$('resendOtp').addEventListener('click',sendOtp);$('verifyOtp').addEventListener('click',verifyOtp);
$('backToPhone').addEventListener('click',()=>{setAuthError('');showPhoneStep()});
$('authPhone').addEventListener('input',event=>{event.target.value=normalizeDigits(event.target.value).replace(/[^\d+]/g,'').slice(0,14)});
$('authUsername').addEventListener('input',event=>{event.target.value=event.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,30)});
$('authCode').addEventListener('input',event=>{event.target.value=normalizeDigits(event.target.value).replace(/\D/g,'').slice(0,6)});
document.addEventListener('keydown',event=>{if(event.key==='Escape')authClose();if(event.key==='Enter'&&$('authOverlay').classList.contains('open')){if(!$('codeStep').hidden)verifyOtp();else sendOtp()}});
$('postFile').addEventListener('change',event=>{showFile(event.target.files&&event.target.files[0]);$('publishButton').disabled=!currentUser||!$('postText').value.trim()||!!selectedFile});
$('globalSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){go('explore');$('exploreSearch').value=event.currentTarget.value;searchUsers()}});
$('exploreSearch').addEventListener('keydown',event=>{if(event.key==='Enter')searchUsers()});
$('postText').addEventListener('input',event=>{const status=$('composerStatus');status.textContent=(event.target.value.trim()||selectedFile)?'پیش‌نویس فقط در همین صفحه نگه داشته شده است؛ هنوز در سرور ذخیره نشده.':'انتشار عمومی هنوز فعال نشده است؛ هیچ محتوایی بدون ذخیره‌سازی واقعی منتشر نمی‌شود.';$('publishButton').disabled=!currentUser||!event.target.value.trim()||!!selectedFile});
try{const saved=JSON.parse(sessionStorage.getItem('vivo_v2_pending_otp')||'null');if(saved&&saved.expiresAt>Date.now()){pendingOtp=saved;$('authName').value=saved.name||'';$('authUsername').value=saved.username||'';$('authPhone').value=saved.phone||''}}catch{}
go('home');checkSession();
})();