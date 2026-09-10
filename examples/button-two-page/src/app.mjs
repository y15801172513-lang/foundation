import {renderPage} from './pages.mjs';

const page = location.pathname.endsWith('/detail') || location.pathname.endsWith('/detail.html') ? {
  pageId:'page_detail', title:'详情页', intro:'这里是详情内容，使用 Button 的 secondary 变体返回首页。', button:{instanceId:'button_instance_detail',variant:'secondary',label:'返回首页',target:'/home'}
} : {
  pageId:'page_home', title:'首页', intro:'这是一个真实可点击的两页 Foundation 预览。', button:{instanceId:'button_instance_home',variant:'primary',label:'查看详情',target:'/detail'}
};
renderPage(page);
