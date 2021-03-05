{"version":3,"sources":["messenger.utils.bundle.js"],"names":["exports","window","BX","Messenger","Const","Utils","dateFormat","Object","freeze","groupTitle","message","recentTitle","recentLinesTitle","default","browser","isSafari","navigator","userAgent","toLowerCase","includes","this","isSafariBased","isChrome","isFirefox","isIe","match","platform","isMac","isLinux","isWindows","isBitrixMobile","isBitrixDesktop","isMobile","isAndroid","isIos","getIosVersion","matches","device","isDesktop","isMobileStatic","orientationHorizontal","orientationPortrait","getOrientation","Math","abs","orientation","types","isString","item","String","isArray","prototype","toString","call","isFunction","Function","isDomNode","babelHelpers","typeof","isDate","isPlainObject","nodeType","hasProp","hasOwnProperty","constructor","e","key","isDarkColor","hex","length","replace","darkColor","bigint","parseInt","red","green","blue","brightness","getDateFormatType","type","arguments","undefined","localize","format","Main","Date","convertBitrixFormat","hashCode","string","hash","JSON","stringify","i","char","charCodeAt","versionCompare","version1","version2","isNumberRegExp","test","NaN","split","push","throttle","callback","wait","context","timeout","callbackArgs","nextCallback","apply","setTimeout","debounce","clearTimeout","htmlspecialchars","htmlspecialcharsback","getLogTrackingParams","params","result","_params$name","name","_params$data","data","_params$dialog","dialog","_params$message","_params$files","files","encodeURIComponent","Array","dataArray","_name","entityId","join"],"mappings":"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","file":"messenger.utils.bundle.map.js"}