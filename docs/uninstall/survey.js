(function (root) {
  "use strict";
  const EMAIL = "quannguyenproducer2505@gmail.com";
  const REASONS = ["performance", "bugs", "visuals", "settings", "not-needed", "other"];
  const TEXT = {
    en: {
      optional:"OPTIONAL FEEDBACK",heading:"What could be better?",intro:"You've removed Better visual Youtube. If you'd like, tell us what didn't work for you.",
      why:"Why did you remove it?",multiple:"Choose any that apply. You can also leave these blank.",
      performance:"Lag or high resource use",bugs:"Something looked broken",visuals:"The visual effects weren't for me",settings:"Settings were hard to use","not-needed":"I no longer need it",other:"Something else",
      detailLabel:"What were you unhappy with, or what would you change?",placeholder:"A little detail helps. Please leave out private information.",detailHint:"Optional. You don't need to share your name or account details.",
      email:"Open feedback email",copy:"Copy feedback",sendHint:"This opens an email draft to QuanNguyen. You review it and choose whether to send.",
      privacy:"Nothing you type here is automatically submitted or saved. You can close this page at any time.",privacyLink:"Privacy policy",
      empty:"Select a reason or add a note first.",copied:"Feedback copied. You can email it to "+EMAIL+".",manual:"Select and copy the text below, then email it to "+EMAIL+".",draft:"If your email app doesn't open, use Copy feedback instead.",subject:"Better visual Youtube — uninstall feedback",none:"Not specified",notes:"What could be better"
    },
    vi: {
      optional:"GÓP Ý TỰ NGUYỆN",heading:"Điều gì chưa hợp với bạn?",intro:"Bạn đã gỡ Better visual Youtube. Nếu tiện, hãy chia sẻ điều khiến bạn chưa hài lòng.",
      why:"Vì sao bạn gỡ tiện ích?",multiple:"Có thể chọn nhiều lý do, hoặc bỏ qua phần này.",
      performance:"Bị giật, lag hoặc tốn tài nguyên",bugs:"Giao diện có lỗi",visuals:"Hiệu ứng chưa hợp ý",settings:"Cài đặt khó dùng","not-needed":"Không còn nhu cầu sử dụng",other:"Lý do khác",
      detailLabel:"Bạn chưa hài lòng ở đâu, hoặc muốn thay đổi điều gì?",placeholder:"Bạn có thể mô tả ngắn ở đây. Đừng đưa thông tin riêng tư vào nhé.",detailHint:"Không bắt buộc. Bạn không cần cung cấp tên hay thông tin tài khoản.",
      email:"Mở email góp ý",copy:"Sao chép góp ý",sendHint:"Nút này mở bản nháp email gửi QuanNguyen. Bạn xem lại rồi tự quyết định gửi.",
      privacy:"Nội dung bạn nhập không tự động được gửi hay lưu lại. Bạn có thể đóng trang bất cứ lúc nào.",privacyLink:"Quyền riêng tư",
      empty:"Hãy chọn một lý do hoặc viết vài dòng trước nhé.",copied:"Đã sao chép. Bạn có thể gửi góp ý đến "+EMAIL+".",manual:"Chọn và sao chép nội dung bên dưới, rồi gửi đến "+EMAIL+".",draft:"Nếu ứng dụng email không mở, bạn có thể dùng nút Sao chép góp ý.",subject:"Better visual Youtube — góp ý khi gỡ",none:"Không nêu lý do",notes:"Điều chưa hài lòng hoặc muốn thay đổi"
    }
  };
  function buildFeedback(input) {
    const lang = input.language === "vi" ? "vi" : "en", t = TEXT[lang];
    const reasons = REASONS.filter(id => Array.isArray(input.reasons) && input.reasons.includes(id));
    const details = typeof input.details === "string" ? input.details.trim().slice(0,2000) : "";
    if (!reasons.length && !details) return null;
    const body = ["Better visual Youtube", "", t.why, reasons.length ? reasons.map(id=>"- "+t[id]).join("\n") : t.none];
    if (details) body.push("",t.notes+":",details);
    return {subject:t.subject,body:body.join("\n")};
  }
  function mailtoFor(feedback) {
    return "mailto:"+EMAIL+"?subject="+encodeURIComponent(feedback.subject)+"&body="+encodeURIComponent(feedback.body);
  }
  if (typeof module !== "undefined" && module.exports) module.exports = {buildFeedback,mailtoFor,REASONS,TEXT};
  if (!root.document) return;
  const doc=root.document, byId=id=>doc.getElementById(id);
  let language = root.navigator && /^vi\b/i.test(root.navigator.language) ? "vi" : "en";
  function translate(lang) {
    language=lang;const t=TEXT[language];doc.documentElement.lang=language;
    doc.querySelectorAll("[data-i18n]").forEach(el=>{el.textContent=t[el.dataset.i18n];});
    doc.querySelectorAll("[data-language]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.language===language)));
    byId("details").placeholder=t.placeholder;
    byId("privacy-link").href="https://github.com/Moments2505/better-visual-youtube/blob/main/docs/PRIVACY-"+(language==="vi"?"VI":"EN")+".md";
    byId("status").textContent="";
  }
  function feedback() {
    const result=buildFeedback({language,reasons:Array.from(doc.querySelectorAll('input[name="reason"]:checked'),el=>el.value),details:byId("details").value});
    if(!result)byId("status").textContent=TEXT[language].empty;
    return result;
  }
  doc.querySelectorAll("[data-language]").forEach(button=>button.addEventListener("click",()=>translate(button.dataset.language)));
  byId("email").addEventListener("click",()=>{
    const result=feedback();if(!result)return;
    byId("status").textContent=TEXT[language].draft;
    root.location.href=mailtoFor(result);
  });
  byId("copy").addEventListener("click",async()=>{
    const result=feedback();if(!result)return;
    try {
      await root.navigator.clipboard.writeText(result.body);
      byId("status").textContent=TEXT[language].copied;
    } catch (_) {
      const preview=byId("feedback-preview");preview.hidden=false;preview.value=result.body;preview.focus();preview.select();
      byId("status").textContent=TEXT[language].manual;
    }
  });
  translate(language);byId("email").disabled=false;byId("copy").disabled=false;
})(typeof window!=="undefined"?window:globalThis);
