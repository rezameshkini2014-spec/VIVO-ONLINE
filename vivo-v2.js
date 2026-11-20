(()=>{
'use strict';
const $=id=>document.getElementById(id);
const toast=(message)=>{const el=$('toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2600)};
const titles={home:'خانه',messages:'پیام‌ها',create:'انتشار محتوا',reels:'ویدئوها',explore:'کشف و جست‌وجو',notifications:'اعلان‌ها',profile:'پروفایل من',settings:'تنظیمات'};
let currentPage='home',selectedFile=null,currentUser=null,pendingOtp=null;
function go(page){
 if(!titles[page])return;
 currentPage=page;
 document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.dataset.view===page));
 document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
 $('pageTitle').textContent=titles[page];
 if(page==='create')$('postText').focus({preventScroll:true});
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
 if(pendingOtp&&pendingOtp.expiresAt>Date.now())showCodeStep();
 else showPhoneStep();
}
function authClose(){$('authOverlay').classList.remove('open');$('authOverlay').setAttribute('aria-hidden','true')}
function showPhoneStep(){$('phoneStep').hidden=false;$('codeStep').hidden=true;$('authTitle').textContent='ساخت حساب یا ورود';$('authDescription').textContent='شماره موبایل خود را تأیید کن تا حساب ابری ویوو برایت فعال شود.'}
function showCodeStep(){$('phoneStep').hidden=true;$('codeStep').hidden=false;$('authTitle').textContent='تأیید شماره موبایل';$('authDescription').textContent='کد شش‌رقمی را از اعلان همین دستگاه وارد کن.';$('otpHelp').textContent='کد برای '+(pendingOtp?.phone||'شماره واردشده')+' ارسال شده و پس از پایان اعتبار قابل استفاده نیست.';$('authCode').focus()}
function base64UrlToBytes(value){const normalized=value.replace(/-/g,'+').replace(/_/g,'/');const padded=normalized+'='.repeat((4-normalized.length%4)%4);const raw=atob(padded);return Uint8Array.from(raw,c=>c.charCodeAt(0))}
async function sendOtp(){
 const phone=normalizePhone($('authPhone').value),name=$('authName').value.trim(),username=$('authUsername').value.trim().toLowerCase();
 if(!/^09\d{9}$/.test(phone))throw new Error('شماره موبایل معتبر ایران وارد کن.');
 if(name.length<2)throw new Error('نام نمایشی باید دست‌کم دو نویسه باشد.');
 if(!usernameValid(username))throw new Error('نام کاربری باید ۴ تا ۳۰ نویسه و با حرف انگلیسی شروع شود.');
 if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw new Error('این مرورگر از اعلان لازم برای دریافت کد پشتیبانی نمی‌کند.');
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
  sessionStorage.setItem('vivo_v2_pending_otp',JSON.stringify(pendingOtp));
  $('authCode').value='';showCodeStep();
 }catch(error){setAuthError(error.message||'ارسال کد انجام نشد.')}
 finally{$('sendOtp').disabled=false;$('sendOtp').textContent='دریافت کد تأیید'}
}
async function verifyOtp(){
 const code=normalizeDigits($('authCode').value).replace(/\D/g,'').slice(0,6);
 if(!pendingOtp||pendingOtp.expiresAt<=Date.now())return setAuthError('مهلت این کد تمام شده است؛ درخواست تازه ثبت کن.');
 if(!/^\d{6}$/.test(code))return setAuthError('کد باید دقیقاً شش رقم باشد.');
 $('verifyOtp').disabled=true;$('verifyOtp').textContent='در حال بررسی…';setAuthError('');
 try{
  await requestJson('/api/otp/verify',{phone:pendingOtp.phone,requestId:pendingOtp.requestId,code});
  const issued=await requestJson('/api/vivo/session',{phone:pendingOtp.phone,name:pendingOtp.name,username:pendingOtp.username});
  currentUser=issued.user;
  try{const profile=await requestJson('/api/vivo/profile');if(profile.user)currentUser=profile.user}catch(error){throw error}
  sessionStorage.removeItem('vivo_v2_pending_otp');pendingOtp=null;
  updateUser(currentUser);authClose();toast('حساب ویوو با موفقیت تأیید و متصل شد.');
 }catch(error){setAuthError(error.message||'تأیید حساب انجام نشد.')}
 finally{$('verifyOtp').disabled=false;$('verifyOtp').textContent='تأیید و ورود'}
}
function updateUser(user){
 currentUser=user||null;
 const login=$('loginButton');
 if(login){login.textContent=currentUser?'خروج':'ورود / ثبت‌نام';login.dataset.action=currentUser?'logout':'login'}
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
 try{const result=await requestJson('/api/vivo/profile');if(result.user)updateUser(result.user)}
 catch{updateUser(null)}
}
async function logout(){
 try{await requestJson('/api/vivo/logout',{})}catch(error){setAuthError(error.message)}
 updateUser(null);toast('از حساب ویوو خارج شدی.');
}
function showFile(file){
 selectedFile=file;
 const preview=$('filePreview');preview.hidden=!file;preview.replaceChildren();
 if(!file)return;
 const label=document.createElement('div');label.textContent=file.name+' · '+Math.ceil(file.size/1024)+' کیلوبایت';preview.append(label);
 if(file.type.startsWith('image/')||file.type.startsWith('video/')){
  const url=URL.createObjectURL(file),media=document.createElement(file.type.startsWith('image/')?'img':'video');
  media.src=url;if(media.tagName==='VIDEO'){media.controls=true;media.playsInline=true}
  preview.append(media);
 }
}
document.addEventListener('click',event=>{
 const pageButton=event.target.closest('[data-page]');
 if(pageButton){event.preventDefault();go(pageButton.dataset.page);return}
 const actionButton=event.target.closest('[data-action]');
 if(!actionButton)return;
 const action=actionButton.dataset.action;
 if(action==='login'){authOpen();return}
 if(action==='logout'){logout();return}
 if(action==='choose-file'){$('postFile').click();return}
 if(action==='publish'){toast('انتشار تا اتصال و آزمون ذخیره‌سازی ابری غیرفعال است.');return}
 if(action==='story'){toast('ساخت و مشاهده استوری پس از اتصال فضای ذخیره‌سازی رسانه فعال می‌شود.');return}
 if(action==='new-chat'){toast('گفت‌وگوی جدید پس از تکمیل سرویس پیام‌رسان فعال می‌شود.');return}
 if(action==='search'){const q=$('exploreSearch').value.trim();if(q)toast('جست‌وجوی ابری هنوز متصل نشده است.');else $('exploreSearch').focus();return}
 if(action==='feed-filter'){toast('فیلتر فید پس از دریافت محتوای واقعی فعال می‌شود.');return}
 if(action==='edit-profile'||action==='account'){if(!currentUser)authOpen();else{go('profile');toast('ویرایش کامل پروفایل در مرحله بعد فعال می‌شود.')}return}
 if(action==='security'||action==='privacy'||action==='notifications'||action==='notification-settings'||action==='appearance'||action==='support'){toast('این تنظیم پس از اتصال سرویس مربوطه فعال می‌شود.');return}
});
$('authClose').addEventListener('click',authClose);
$('authOverlay').addEventListener('click',event=>{if(event.target===$('authOverlay'))authClose()});
$('sendOtp').addEventListener('click',sendOtp);
$('resendOtp').addEventListener('click',sendOtp);
$('verifyOtp').addEventListener('click',verifyOtp);
$('backToPhone').addEventListener('click',()=>{setAuthError('');showPhoneStep()});
$('authPhone').addEventListener('input',event=>{event.target.value=normalizeDigits(event.target.value).replace(/[^\d+]/g,'').slice(0,14)});
$('authUsername').addEventListener('input',event=>{event.target.value=event.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,30)});
$('authCode').addEventListener('input',event=>{event.target.value=normalizeDigits(event.target.value).replace(/\D/g,'').slice(0,6)});
document.addEventListener('keydown',event=>{if(event.key==='Escape')authClose();if(event.key==='Enter'&&$('authOverlay').classList.contains('open')){if(!$('codeStep').hidden)verifyOtp();else sendOtp()}});
$('postFile').addEventListener('change',event=>showFile(event.target.files&&event.target.files[0]));
$('globalSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){go('explore');$('exploreSearch').value=event.currentTarget.value;toast('جست‌وجوی ابری هنوز متصل نشده است.')}});
$('chatSearch').addEventListener('input',()=>{});
$('exploreSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){const q=event.currentTarget.value.trim();if(q)toast('جست‌وجوی ابری هنوز متصل نشده است.')}});
$('postText').addEventListener('input',event=>{const status=$('composerStatus');status.textContent=(event.target.value.trim()||selectedFile)?'پیش‌نویس فقط در همین صفحه نگه داشته شده است؛ هنوز در سرور ذخیره نشده.':'انتشار عمومی هنوز فعال نشده است؛ هیچ محتوایی بدون ذخیره‌سازی واقعی منتشر نمی‌شود.'});
try{const saved=JSON.parse(sessionStorage.getItem('vivo_v2_pending_otp')||'null');if(saved&&saved.expiresAt>Date.now()){pendingOtp=saved;$('authName').value=saved.name||'';$('authUsername').value=saved.username||'';$('authPhone').value=saved.phone||''}}catch{}
go('home');checkSession();
})();