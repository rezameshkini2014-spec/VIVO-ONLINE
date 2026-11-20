(()=>{
'use strict';
const $=id=>document.getElementById(id);
const toast=(message)=>{const el=$('toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2600)};
const titles={home:'خانه',messages:'پیام‌ها',create:'انتشار محتوا',reels:'ویدئوها',explore:'کشف و جست‌وجو',notifications:'اعلان‌ها',profile:'پروفایل من',settings:'تنظیمات'};
let currentPage='home',selectedFile=null;
function go(page){
 if(!titles[page])return;
 currentPage=page;
 document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.dataset.view===page));
 document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
 $('pageTitle').textContent=titles[page];
 if(page==='create')$('postText').focus({preventScroll:true});
 window.scrollTo({top:0,behavior:'smooth'});
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
 if(action==='choose-file'){$('postFile').click();return}
 if(action==='publish'){toast('انتشار تا اتصال و آزمون ذخیره‌سازی ابری غیرفعال است.');return}
 if(action==='story'){toast('ساخت و مشاهده استوری پس از اتصال فضای ذخیره‌سازی رسانه فعال می‌شود.');return}
 if(action==='new-chat'){toast('گفت‌وگوی جدید پس از تکمیل احراز هویت و سرویس پیام‌رسان فعال می‌شود.');return}
 if(action==='search'){const q=$('exploreSearch').value.trim();if(q)toast('جست‌وجوی ابری هنوز متصل نشده است.');else $('exploreSearch').focus();return}
 if(action==='feed-filter'){toast('فیلتر فید پس از دریافت محتوای واقعی فعال می‌شود.');return}
 if(action==='edit-profile'||action==='account'){go('profile');toast('ویرایش اطلاعات پس از اتصال حساب کاربری فعال می‌شود.');return}
 if(action==='security'||action==='privacy'||action==='notifications'||action==='notification-settings'||action==='appearance'||action==='support'){toast('این تنظیم پس از اتصال سرویس مربوطه فعال می‌شود.');return}
});
$('postFile').addEventListener('change',event=>showFile(event.target.files&&event.target.files[0]));
$('globalSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){go('explore');$('exploreSearch').value=event.currentTarget.value;toast('جست‌وجوی ابری هنوز متصل نشده است.')}});
$('chatSearch').addEventListener('input',()=>{});
$('exploreSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){const q=event.currentTarget.value.trim();if(q)toast('جست‌وجوی ابری هنوز متصل نشده است.')}});
$('postText').addEventListener('input',event=>{const status=$('composerStatus');status.textContent=event.target.value.trim()||selectedFile?'پیش‌نویس فقط در همین صفحه نگه داشته شده است؛ هنوز در سرور ذخیره نشده.':'انتشار عمومی هنوز فعال نشده است؛ هیچ محتوایی بدون ذخیره‌سازی واقعی منتشر نمی‌شود.'});
go('home');
})();