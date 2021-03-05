{"version":3,"sources":["script.js"],"names":["BitrixSUG","this","bLoadStarted","refreshUrl","mainFilterUsed","sortKey","project","prototype","init","params","top","location","href","keyboardPageNavigation","navId","initKeyboardPageNavigation","processNavigation","BX","addCustomEvent","delegate","filterValues","filterPromise","showRefreshFade","filterParams","autoResolve","refresh","useBXMainFilter","searchString","util","trim","length","hideRefreshFade","event","getEventId","eventData","getData","type","isNotEmptyString","code","SocialnetworkUICommon","reload","sendRequest","groupId","parseInt","action","in_array","requestParams","actionUrl","value","add_url_param","b24statAction","ajax","url","method","dataType","data","sessid","bitrix_sessid","site","message","onsuccess","responseData","SUCCESS","callback_success","callback_failure","ERROR","onfailure","showRequestWait","target","addClass","closeRequestWait","removeClass","setFavorites","node","active","flyingStar","cloneNode","style","marginLeft","offsetWidth","parentNode","appendChild","easing","duration","start","opacity","scale","finish","transition","transitions","linear","step","state","transform","complete","removeChild","animate","adjust","attrs","title","setRequestSent","sentNode","role","showRequestSent","showError","errorText","errorPopup","PopupWindow","Math","random","window","autoHide","lightShadow","zIndex","content","create","props","className","html","replace","closeByEsc","closeIcon","show","showSortMenu","PopupMenu","destroy","bindNode","text","onclick","proxy","selectSortMenuItem","key","valueNode","userId","showMembersCountItem","offsetLeft","offsetTop","angle","position","offset","setSortMenuItemText","innerHTML","indexOf","order","urlParams","prepareData","fulfill","loaderContainer","cleanNode","PROPS","EMPTY","id","children","CONTENT","processAjaxBlock","reject","showRefreshError","hasClass","setTimeout","block","htmlWasInserted","scriptsLoaded","insertHTML","processInlineJS","processRequestData","scriptsRunFirst","addEventListener","ctrlKey","metaKey","keyCode","link","preventDefault","stopImmediatePropagation","navContainer","anchorsList","findChildren","tagName","i","bind","e","currentTarget","clickNavigation","oSUG"],"mappings":"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","file":"script.map.js"}