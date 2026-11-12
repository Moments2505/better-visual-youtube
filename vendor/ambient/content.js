(function () {
  'use strict';

  
  let console;
  
  (function () {
    const preMessage = 'Ambient light for YouTube™ |';
  
    const enrich = (...args) => {
      if (args.length <= 0) return args;
  
      if (typeof args[0] === 'string') {
        const [firstArg, ...postArgs] = args;
        return [`${preMessage} ${firstArg}`, ...postArgs];
      }
  
      return [preMessage, ...args];
    };
  
    console = {
      log: (...args) => globalThis.console.log(...enrich(...args)),
      debug: (...args) => globalThis.console.debug(...enrich(...args)),
      warn: (...args) => globalThis.console.warn(...enrich(...args)),
      error: (...args) => globalThis.console.error(...enrich(...args)),
      dir: (...args) => globalThis.console.dir(...args),
    };
  })();


  const getVersion = () => {
    try {
      return (chrome.runtime.getManifest() || {}).version;
    } catch {
      return null;
    }
  };

  const uuidv4 = () => {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  };
  let errorHandler = ex => {
    console.error(ex);
  };
  const setErrorHandler = handler => {
    errorHandler = handler;
  };
  const wrapErrorHandlerHandleError = (stack, ex, reportOnce, reported) => {
    if (reportOnce) {
      if (reported.includes(ex.message)) return;
      reported.push(ex.message);
    }
    appendErrorStack(stack, ex);
    if (errorHandler) errorHandler(ex);
  };
  const withErrorHandler = (callback, reportOnce, stack, reported) => {
    const callbackName = callback.name || 'anonymous';
    const container = {
      [callbackName]: (...args) => {
        try {
          return callback(...args);
        } catch (ex) {
          wrapErrorHandlerHandleError(stack, ex, reportOnce, reported);
        }
      }
    };
    return container[callbackName];
  };
  const withAsyncErrorHandler = (callback, reportOnce, stack, reported) => {
    const callbackName = callback.name || 'anonymous';
    const container = {
      [callbackName]: async (...args) => {
        try {
          return await callback(...args);
        } catch (ex) {
          wrapErrorHandlerHandleError(stack, ex, reportOnce, reported);
        }
      }
    };
    return container[callbackName];
  };
  const wrapErrorHandler = (callback, reportOnce = false) => (callback.constructor.name === 'AsyncFunction' ? withAsyncErrorHandler : withErrorHandler)(callback, reportOnce, new Error().stack, []);
  const eventListenerCallbacks = [];
  function on(elem, eventNames, callback, options, reportOnce = false) {
    try {
      const stack = new Error().stack;
      const callbacksName = `on_${eventNames.split(' ').join('_')}`;
      let reported = [];
      const namedCallbacks = {
        [callbacksName]: async (...args) => {
          try {
            await callback(...args);
          } catch (ex) {
            if (reportOnce) {
              if (reported.includes(ex.message)) return;
              reported.push(ex.message);
            }
            const e = args.length ? args[0] : {};
            const type = e.type === 'keydown' ? `${e.type} keyCode: ${e.keyCode}` : e.type;
            ex.message = `${ex.message} \nOn event: ${type}`;
            try {
              if (elem) {
                ex.message = `${ex.message} \nElem: ${elem.toString()} ${elem.nodeName || ''}#${elem.id || ''}.${elem.className || ''}`;
              }
            } catch (elemEx) {
              ex.details = {
                ...(ex.details || {}),
                elemEx
              };
            }
            try {
              if (e !== null && e !== void 0 && e.target) {
                ex.message = `${ex.message} \nTarget: ${e.target.toString()} ${e.target.nodeName || ''}#${e.target.id || ''}.${e.target.className || ''}`;
              }
            } catch (targetEx) {
              ex.details = {
                ...(ex.details || {}),
                targetEx
              };
            }
            try {
              if (e !== null && e !== void 0 && e.currentTarget) {
                ex.message = `${ex.message} \nCurrentTarget: ${e.currentTarget.toString()} ${e.currentTarget.nodeName || ''}#${e.currentTarget.id || ''}.${e.currentTarget.className || ''}`;
              }
            } catch (currentTargetEx) {
              ex.details = {
                ...(ex.details || {}),
                currentTargetEx
              };
            }
            ex.details = {
              ...(ex.details || {}),
              eventNames,
              options,
              reportOnce
            };
            appendErrorStack(stack, ex);
            if (errorHandler) errorHandler(ex);
          }
        }
      };
      const eventListenerCallback = namedCallbacks[callbacksName];
      const eventNamesList = eventNames.split(' ');
      const existingEventListenerCallback = eventListenerCallbacks.find(e => e.args.elem === elem && e.args.callback === callback && JSON.stringify(e.args.options) === JSON.stringify(options));
      for (const eventName of eventNamesList) {
        if (existingEventListenerCallback) {
          if (existingEventListenerCallback.args.eventNamesList.includes(eventName)) {
            continue;
          } else {
            existingEventListenerCallback.args.eventNamesList.push(eventName);
          }
        }
        elem.addEventListener(eventName, eventListenerCallback, options);
      }
      if (!existingEventListenerCallback) {
        eventListenerCallbacks.push({
          args: {
            elem,
            eventNamesList,
            callback,
            options
          },
          callback: eventListenerCallback
        });
      }
    } catch (ex) {
      ex.details = {
        eventNames,
        options,
        reportOnce
      };
      try {
        if (elem) {
          ex.message = `${ex.message} \nFor element: ${elem.toString()} ${elem.nodeName || ''}#${elem.id || ''}.${elem.className || ''}`;
        }
      } catch (elemEx) {
        ex.details = {
          ...(ex.details || {}),
          elemEx
        };
      }
      console.log('catched', ex);
      throw ex;
    }
  }
  globalThis.matchMedia?.('(color-gamut: p3)')?.matches ? 'display-p3' : 'srgb';
  globalThis.matchMedia?.('(color-gamut: rec2020)')?.matches ? 'rec2020' : globalThis.matchMedia?.('(color-gamut: p3)')?.matches ? 'display-p3' : 'srgb';
  const appendErrorStack = (stack, ex) => {
    try {
      var _ref;
      const stackToAppend = stack === null || stack === void 0 ? void 0 : stack.substring((stack === null || stack === void 0 ? void 0 : stack.indexOf('\n')) + 1);
      const stackToSearch = stackToAppend === null || stackToAppend === void 0 ? void 0 : stackToAppend.substring((stackToAppend === null || stackToAppend === void 0 ? void 0 : stackToAppend.indexOf('\n')) + 1);
      const alreadyContainsStack = ((_ref = (ex === null || ex === void 0 ? void 0 : ex.stack) || (ex === null || ex === void 0 ? void 0 : ex.message) || (ex === null || ex === void 0 ? void 0 : ex.toString())) === null || _ref === void 0 ? void 0 : _ref.indexOf(stackToSearch)) !== -1;
      if (!alreadyContainsStack) {
        ex.stack = `${ex.stack || ex.message || ex.toString()}\n${stackToAppend}`;
      }
    } catch (ex) {
      console.warn(ex);
    }
  };
  const isEmbedPageUrl = () => {
    var _location$pathname;
    return (_location$pathname = location.pathname) === null || _location$pathname === void 0 ? void 0 : _location$pathname.startsWith('/embed/');
  };
  const networkStateToString = value => (({
    0: 'NETWORK_EMPTY',
    1: 'NETWORK_IDLE',
    2: 'NETWORK_LOADING',
    3: 'NETWORK_NO_SOURCE'
  })[value] || value) ?? 'UNKNOWN';
  const readyStateToString = value => (({
    0: 'HAVE_NOTHING',
    1: 'HAVE_METADATA',
    2: 'HAVE_CURRENT_DATA',
    3: 'HAVE_FUTURE_DATA',
    4: 'HAVE_ENOUGH_DATA'
  })[value] || value) ?? 'UNKNOWN';
  const mediaErrorToString = value => (({
    1: 'MEDIA_ERR_ABORTED',
    2: 'MEDIA_ERR_NETWORK',
    3: 'MEDIA_ERR_DECODE',
    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
  })[value] || value) ?? 'UNKNOWN';
  const watchSelectors = ['ytd-watch-flexy', 'ytd-watch-fixie', 'ytd-watch-grid'];
  let warningElem;
  let warningElemText;
  const setWarning = text => {
    if (!warningElem) {
      const elem = document.createElement('div');
      elem.style.position = 'fixed';
      elem.style.zIndex = 999999;
      elem.style.left = 0;
      elem.style.bottom = 0;
      elem.style.padding = '5px 8px';
      elem.style.background = 'rgba(0,0,0,.99)';
      elem.style.color = '#fff';
      elem.style.border = '1px solid #f80';
      elem.style.borderTopRightRadius = '3px';
      elem.style.whiteSpace = 'pre-wrap';
      elem.style.fontSize = '15px';
      elem.style.lineHeight = '18px';
      elem.style.fontFamily = 'sans-serif';
      elem.style.overflowWrap = 'anywhere';
      elem.style.overflow = 'hidden';
      warningElem = elem;
      const closeButton = document.createElement('button');
      closeButton.style.position = 'absolute';
      closeButton.style.zIndex = 2;
      closeButton.style.right = 0;
      closeButton.style.top = 0;
      closeButton.style.border = 'none';
      closeButton.style.borderBottomLeftRadius = '3px';
      closeButton.style.padding = '0px 8px';
      closeButton.style.background = '#f80';
      closeButton.style.fontWeight = 'bold';
      closeButton.style.fontFamily = 'inherit';
      closeButton.style.lineHeight = '20px';
      closeButton.style.fontSize = '22px';
      closeButton.style.color = '#000';
      closeButton.style.cursor = 'pointer';
      closeButton.textContent = 'x';
      on(closeButton, 'click', () => setWarning(''));
      elem.appendChild(closeButton);
      const titleElem = document.createElement('div');
      titleElem.style.fontWeight = 'bold';
      titleElem.style.color = '#008cff';
      titleElem.style.fontSize = '22px';
      titleElem.style.lineHeight = '28px';
      titleElem.textContent = 'Ambient light for YouTube™\n';
      elem.appendChild(titleElem);
      const textElem = document.createElement('div');
      warningElemText = textElem;
      elem.appendChild(textElem);
    }
    const elem = warningElem;
    if (text) {
      warningElemText.textContent = text;
      document.documentElement.appendChild(elem);
    } else {
      warningElemText.textContent = '';
      elem.remove();
    }
  };

  class Storage {
    constructor() {
      this.onChangedListeners = [];
    }
    async set(nameOrNamesAndValues, value = undefined, throwOnUninstalled = false) {
      try {
        const multiple = typeof nameOrNamesAndValues !== 'string';
        const namesAndValues = multiple ? nameOrNamesAndValues : {
          [nameOrNamesAndValues]: value
        };
        const stack = new Error().stack;
        return await new Promise(function storageSet(resolve, reject) {
          try {
            var _chrome, _chrome$runtime;
            if (!((_chrome = chrome) !== null && _chrome !== void 0 && (_chrome$runtime = _chrome.runtime) !== null && _chrome$runtime !== void 0 && _chrome$runtime.id)) throw new Error('uninstalled');
            const setCallback = () => {
              try {
                if (chrome.runtime.lastError) throw chrome.runtime.lastError;
                resolve();
              } catch (ex) {
                var _chrome2, _chrome2$runtime;
                if (!((_chrome2 = chrome) !== null && _chrome2 !== void 0 && (_chrome2$runtime = _chrome2.runtime) !== null && _chrome2$runtime !== void 0 && _chrome2$runtime.id)) return reject(new Error('uninstalled'));
                appendErrorStack(stack, ex);
                reject(ex);
              }
            };
            if (!multiple && value === undefined) {
              chrome.storage.local.remove([nameOrNamesAndValues], setCallback);
            } else {
              chrome.storage.local.set(namesAndValues, setCallback);
            }
          } catch (ex) {
            var _chrome3, _chrome3$runtime;
            if (!((_chrome3 = chrome) !== null && _chrome3 !== void 0 && (_chrome3$runtime = _chrome3.runtime) !== null && _chrome3$runtime !== void 0 && _chrome3$runtime.id)) return reject(new Error('uninstalled'));
            appendErrorStack(stack, ex);
            reject(ex);
          }
        });
      } catch (ex) {
        var _ex$message;
        if (ex && (throwOnUninstalled || !(ex.message === 'uninstalled' || (_ex$message = ex.message) !== null && _ex$message !== void 0 && _ex$message.includes('QuotaExceededError')))) throw ex;
      }
    }
    async get(nameOrNames, throwOnUninstalled = false) {
      try {
        const multiple = typeof nameOrNames !== 'string';
        const names = multiple ? nameOrNames : [nameOrNames];
        const stack = new Error().stack;
        return await new Promise(function storageGet(resolve, reject) {
          try {
            var _chrome4, _chrome4$runtime;
            if (!((_chrome4 = chrome) !== null && _chrome4 !== void 0 && (_chrome4$runtime = _chrome4.runtime) !== null && _chrome4$runtime !== void 0 && _chrome4$runtime.id)) throw new Error('uninstalled');
            chrome.storage.local.get(names, function getCallback(result) {
              try {
                if (chrome.runtime.lastError) throw chrome.runtime.lastError;
                resolve(multiple ? result : result[nameOrNames] === undefined ? null : result[nameOrNames]);
              } catch (ex) {
                var _chrome5, _chrome5$runtime;
                if (!((_chrome5 = chrome) !== null && _chrome5 !== void 0 && (_chrome5$runtime = _chrome5.runtime) !== null && _chrome5$runtime !== void 0 && _chrome5$runtime.id)) return reject(new Error('uninstalled'));
                appendErrorStack(stack, ex);
                reject(ex);
              }
            });
          } catch (ex) {
            var _chrome6, _chrome6$runtime;
            if (!((_chrome6 = chrome) !== null && _chrome6 !== void 0 && (_chrome6$runtime = _chrome6.runtime) !== null && _chrome6$runtime !== void 0 && _chrome6$runtime.id)) return reject(new Error('uninstalled'));
            appendErrorStack(stack, ex);
            reject(ex);
          }
        });
      } catch (ex) {
        var _ex$message2;
        if (ex && (throwOnUninstalled || !(ex.message === 'uninstalled' || (_ex$message2 = ex.message) !== null && _ex$message2 !== void 0 && _ex$message2.includes('QuotaExceededError')))) throw ex;
      }
    }
    addListener(handler) {
      try {
        const wrappedHandler = wrapErrorHandler(handler, true);
        chrome.storage.local.onChanged.addListener(wrappedHandler);
        this.onChangedListeners.push({
          handler,
          wrappedHandler
        });
      } catch (ex) {
        console.warn("Failed to listen to storage changes. If any setting changes you'll have to manually refresh the page to update them.");
        console.debug(ex);
      }
    }
    removeListener(handler) {
      try {
        const entry = this.onChangedListeners.find(entry => entry.handler === handler);
        if (!entry) throw new Error('Cannot remove a storage.local.onChange listener that has never been added');
        chrome.storage.local.onChanged.removeListener(entry.wrappedHandler);
        this.onChangedListeners.splice(this.onChangedListeners.indexOf(entry), 1);
      } catch {
        console.warn("Failed to listen to storage changes. If any setting changes you'll have to manually refresh the page to update them.");
      }
    }
  }
  const storage = new Storage();
  const defaultCrashOptions = {
    video: false,
    technical: false,
    crash: false
  };

  const SettingsConfig = [{
    type: 'section',
    label: 'Settings',
    name: 'sectionSettingsCollapsed',
    default: true
  }, {
    name: 'advancedSettings',
    label: 'Advanced',
    type: 'checkbox',
    default: false
  }, {
    type: 'section',
    label: 'Stats',
    name: 'sectionStatsCollapsed',
    default: true,
    advanced: true
  }, {
    name: 'showFPS',
    label: 'Framerates',
    type: 'checkbox',
    default: false,
    advanced: true
  }, {
    name: 'showFrametimes',
    label: 'Frametimes graph',
    description: 'Uses: CPU power',
    questionMark: {
      title: 'The measured display framerate is not a reflection of the real performance.\nBecause the measurement uses an extra percentage of CPU usage.\nHowever, this statistic could be helpful to debug other issues.'
    },
    type: 'checkbox',
    default: false,
    advanced: true
  }, {
    name: 'showResolutions',
    label: 'Resolutions & drawtimes',
    type: 'checkbox',
    default: false,
    advanced: true
  }, {
    name: 'showBarDetectionStats',
    label: 'Bar detection',
    type: 'checkbox',
    default: false,
    advanced: true
  }, {
    type: 'section',
    label: 'Quality',
    name: 'sectionQualityPerformanceCollapsed',
    default: true
  }, {
    name: 'webGL',
    label: 'WebGL renderer (uses less power)',
    description: 'Changing this reloads the webpage',
    type: 'checkbox',
    default: true
  }, {
    name: 'resolution',
    label: 'Resolution',
    type: 'list',
    default: 100,
    unit: '%',
    valuePoints: (() => {
      const points = [6.25];
      while (points[points.length - 1] < 400) {
        points.push(points[points.length - 1] * 2);
      }
      return points;
    })(),
    manualinput: false
  }, {
    name: 'framerateLimit',
    label: 'Limit framerate (per second)',
    type: 'list',
    default: 60,
    min: 0,
    max: 60,
    step: 1
  }, {
    name: 'frameSync',
    label: 'Synchronization',
    questionMark: {
      title: 'How much energy will be spent on sychronising ambient light frames with video frames.\n\nDecoded framerate: Lowest CPU & GPU usage.\nMight result in dropped and delayed frames.\n\nDisplay framerate: Highest CPU & GPU usage.\nMight still result in delayed frames on high refreshrate monitors (120hz and higher) and higher than 1080p videos.\n\nVideo framerate: Lowest CPU & GPU usage.\nUses the newest browser technology to always keep the frames in sync.'
    },
    type: 'list',
    default: 2,
    min: 0,
    max: 2,
    step: 1,
    snapPoints: [{
      value: 0,
      label: 'Decoded'
    }, {
      value: 1,
      label: 'Display'
    }, {
      value: 2,
      label: 'Video'
    }],
    manualinput: false,
    advanced: true,
    experimental: true
  }, {
    name: 'energySaver',
    label: 'Save energy on static videos',
    questionMark: {
      title: 'Limits the framerate on videos with an (almost) static image\n\nStill image: 1 frame per 5 seconds\nSmall movements: 1 frame per second'
    },
    type: 'checkbox',
    default: false,
    advanced: true
  }, {
    name: 'prioritizePageLoadSpeed',
    label: 'Prioritize page load speed',
    description: 'Loads the ambient light after the page has loaded',
    type: 'checkbox',
    default: true
  }, {
    name: 'layoutPerformanceImprovements',
    label: 'YouTube responsiveness fixes',
    description: 'Improves the responsiveness of the webpage',
    questionMark: {
      title: `Some of the improvements on the /watch page include:
- Faster webpage resizing and scrolling (Most noticeable after you've loaded in more than 100 comments)
- Faster loadingtimes for comments and/or related videos
- Smoother timeline scrubbing (Most noticeable after you've loaded in more than 100 comments or with a livestream chat window open)
- Smoother livestream chat scrolling (and new messages will be appended quicker to the chat)
- Smoother playlist scrolling (Most noticeable in a playlist with more than 25 videos)
- Smoother dragging/re-ordering videos in a playlist (Most noticeable in a playlist with more than 25 videos)`
    },
    type: 'checkbox',
    default: true,
    advanced: true
  }, {
    name: 'debandingBlendMode',
    label: 'Optimize debanding for',
    questionMark: {
      title: "The normal blend mode is usefull to fix banding in dark colors on LCD's.\nBut on OLED's it's better to use the \"overlay\" blend mode to retain pure blacks."
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 1,
    step: 1,
    snapPoints: [{
      value: 0,
      label: 'LCD (normal)'
    }, {
      value: 1,
      label: 'OLED (overlay)'
    }],
    manualinput: false,
    advanced: true,
    new: true
  }, {
    type: 'section',
    label: 'Page header',
    name: 'sectionOtherPageHeaderCollapsed',
    default: true
  }, {
    name: 'headerShadowSize',
    label: 'Shadows size',
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 0.1
  }, {
    name: 'headerShadowOpacity',
    label: 'Shadows opacity',
    type: 'list',
    default: 30,
    min: 0,
    max: 100,
    step: 0.1
  }, {
    name: 'headerImagesOpacity',
    label: 'Images opacity',
    type: 'list',
    default: 100,
    min: 0,
    max: 100,
    step: 0.1
  }, {
    name: 'headerFillOpacity',
    label: 'Background opacity',
    description: 'Only applies when scrolled down',
    type: 'list',
    default: 100,
    min: -100,
    max: 100,
    step: 0.1,
    advanced: true
  }, {
    type: 'section',
    label: 'Page content',
    name: 'sectionOtherPageContentCollapsed',
    default: true
  }, {
    name: 'surroundingContentShadowSize',
    label: 'Shadows size',
    type: 'list',
    default: 15,
    min: 0,
    max: 100,
    step: 0.1
  }, {
    name: 'surroundingContentShadowOpacity',
    label: 'Shadows opacity',
    type: 'list',
    default: 30,
    min: 0,
    max: 100,
    step: 0.1
  }, {
    name: 'surroundingContentTextAndBtnOnly',
    label: 'Shadows on texts and buttons only',
    description: 'Decreases scrolling & video stutter',
    type: 'checkbox',
    advanced: true,
    default: true
  }, {
    name: 'surroundingContentImagesOpacity',
    label: 'Images opacity',
    type: 'list',
    default: 100,
    min: 0,
    max: 100,
    step: 0.1
  }, {
    name: 'surroundingContentFillOpacity',
    label: 'Buttons & boxes background opacity',
    type: 'list',
    default: 10,
    min: -100,
    max: 100,
    step: 0.1
  }, {
    name: 'pageBackgroundGreyness',
    label: 'Background greyness',
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 0.1
  }, {
    name: 'immersiveTheaterView',
    label: 'Hide everything in theater mode',
    type: 'checkbox',
    default: false
  }, {
    name: 'relatedScrollbar',
    label: 'Related videos as scrollable list',
    description: 'Also improves scrolling through comments',
    type: 'checkbox',
    advanced: true,
    default: false
  }, {
    name: 'hideScrollbar',
    label: 'Hide scrollbar',
    type: 'checkbox',
    advanced: true,
    default: false
  }, {
    type: 'section',
    label: 'Video',
    name: 'sectionVideoResizingCollapsed',
    default: true
  }, {
    name: 'videoScale.SMALL',
    label: 'Size (in small view)',
    type: 'list',
    default: 100,
    min: 25,
    max: 200,
    step: 0.1,
    new: true
  }, {
    name: 'videoScale.THEATER',
    label: 'Size (in theater view)',
    type: 'list',
    default: 100,
    min: 25,
    max: 200,
    step: 0.1,
    new: true
  }, {
    name: 'videoScale.FULLSCREEN',
    label: 'Size (in fullscreen)',
    type: 'list',
    default: 100,
    min: 25,
    max: 200,
    step: 0.1,
    new: true
  }, {
    name: 'videoShadowSize',
    label: 'Shadow size',
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 0.1
  }, {
    name: 'videoShadowOpacity',
    label: 'Shadow opacity',
    type: 'list',
    default: 50,
    min: 0,
    max: 100,
    step: 0.1
  }, {
    name: 'videoDebandingStrength',
    label: 'Debanding (noise)',
    questionMark: {
      title: 'Click for more information about debanding (noise /dithering).\nTip: Change the "Quality > Optimize debanding for" setting to "OLED" to retain pure blacks on OLED displays.',
      href: 'https://www.lifewire.com/what-is-dithering-4686105'
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    advanced: true
  }, {
    name: 'videoOverlayEnabled',
    label: 'Sync video with ambient light',
    questionMark: {
      title: 'Delays the video frames according to the ambient light frametimes.\nThis makes sure that that the ambient light is never out of sync with the video,\nbut it can introduce stuttering and/or dropped frames.'
    },
    type: 'checkbox',
    default: false,
    advanced: true
  }, {
    name: 'videoOverlaySyncThreshold',
    label: 'Sync video disable threshold',
    description: 'Disable when dropping % of frames',
    type: 'list',
    default: 5,
    min: 1,
    max: 100,
    step: 1,
    advanced: true
  }, {
    name: 'chromiumBugVideoJitterWorkaround',
    label: 'Video jitter workaround',
    description: 'Uses: CPU & GPU power',
    questionMark: {
      title: 'Chromium has a bug that jitters the video playback when your display \nhas a higher framerate than 60Hz. This workaround prevents the jittering \nby forcing the browser to run at the framerate of your display instead. \nClick the questionmark for more information about this bug in Chromium browsers.',
      href: 'https://github.com/WesselKroos/youtube-ambilight/issues/166'
    },
    type: 'checkbox',
    default: false,
    advanced: true
  }, {
    name: 'chromiumDirectVideoOverlayWorkaround',
    label: 'Video artifacts workaround',
    description: 'This workaround must be disabled for \nNVidia RTX Virtual Super Resolution (VSR)',
    questionMark: {
      title: `This workaround can fix several artifacts/bugs,
when videos are in hardware accelerated overlays (MPO).
Examples are: random black/white squares, flickering or a squeezed video.

Click on the questionmark for more and updated information about these artifacts/bugs.`,
      href: 'https://github.com/WesselKroos/youtube-ambilight/blob/master/TROUBLESHOOT.md#3-nvidia-rtx-video-super-resolution-vsr--nvidia-rtx-video-hdr-does-not-work'
    },
    type: 'checkbox',
    default: false,
    advanced: true
  }, {
    type: 'section',
    label: 'Remove black & colored bars',
    name: 'sectionHorizontalBarsCollapsed',
    default: true
  }, {
    name: 'detectHorizontalBarSizeEnabled',
    label: 'Remove black bars',
    description: 'Uses: CPU power',
    type: 'checkbox',
    default: false,
    defaultKey: 'B'
  }, {
    name: 'detectVerticalBarSizeEnabled',
    label: 'Remove black sidebars',
    description: 'Uses: CPU power',
    type: 'checkbox',
    default: false,
    defaultKey: 'V'
  }, {
    name: 'detectColoredHorizontalBarSizeEnabled',
    label: 'Detection: Remove colored bars',
    type: 'checkbox',
    default: false
  }, {
    name: 'detectHorizontalBarSizeOffsetPercentage',
    label: 'Detection: Offset',
    type: 'list',
    default: 0,
    min: -5,
    max: 5,
    step: 0.1,
    advanced: true
  }, {
    name: 'barSizeDetectionAverageHistorySize',
    label: 'Detection: Frames average',
    questionMark: {
      title: 'The amount of video frames to detect an average bar size from. \nA lower amount of frames results in a faster detection, \nbut does also increase the amount of inaccurate detections.'
    },
    type: 'list',
    default: 4,
    min: 1,
    max: 30,
    step: 1,
    advanced: true
  }, {
    name: 'barSizeDetectionAllowedElementsPercentage',
    label: 'Detection: Certainty threshold',
    questionMark: {
      title: 'At 10% only clear bars are removed.\nA higher percentage can also remove bars with some elements.\nAnd an even higher percentage can crop to a squared element in the center.'
    },
    type: 'list',
    default: 20,
    min: 10,
    max: 90,
    step: 10
  }, {
    name: 'barSizeDetectionAllowedUnevenBarsPercentage',
    label: 'Detection: Uneven threshold',
    questionMark: {
      title: 'Higher percentages detect a more uneven bar.\nFor example: A bar is uneven when the top bar is smaller than the bottem bar.\nBut with a high percentage you also increase the risk that straight objects or lines are seen as bars.'
    },
    type: 'list',
    default: 10,
    min: 1,
    max: 50,
    step: 1,
    advanced: true,
    new: true
  }, {
    name: 'horizontalBarsClipPercentage',
    label: 'Bar size',
    type: 'list',
    default: 0,
    min: 0,
    max: 40,
    step: 0.1,
    snapPoints: [{
      value: 8.7,
      label: 8
    }, {
      value: 12.3,
      label: 12,
      flip: true
    }, {
      value: 13.5,
      label: 13
    }],
    advanced: true
  }, {
    name: 'verticalBarsClipPercentage',
    label: 'Sidebars size',
    type: 'list',
    default: 0,
    min: 0,
    max: 40,
    step: 0.1,
    advanced: true
  }, {
    name: 'horizontalBarsClipPercentageReset',
    label: 'Reset bars next video',
    type: 'checkbox',
    default: true,
    advanced: true
  }, {
    name: 'detectVideoFillScaleEnabled',
    label: 'Fill video to removed bars',
    type: 'checkbox',
    default: false,
    defaultKey: 'H'
  }, {
    type: 'section',
    label: 'Filters',
    name: 'sectionImageAdjustmentCollapsed',
    default: true
  }, {
    name: 'brightness',
    label: 'Brightness',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1
  }, {
    name: 'contrast',
    label: 'Contrast',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
    advanced: true
  }, {
    name: 'vibrance',
    label: 'Colors',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 0.1
  }, {
    name: 'saturation',
    label: 'Saturation',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1
  }, {
    type: 'section',
    label: 'HDR Filters',
    name: 'sectionHdrImageAdjustmentCollapsed',
    default: false,
    hdr: true
  }, {
    name: 'hdrBrightness',
    label: 'Brightness',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
    hdr: true
  }, {
    name: 'hdrContrast',
    label: 'Contrast',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
    hdr: true
  }, {
    name: 'hdrSaturation',
    label: 'Saturation',
    type: 'list',
    default: 100,
    min: 0,
    max: 200,
    step: 1,
    hdr: true
  }, {
    type: 'section',
    label: 'Directions',
    name: 'sectionDirectionsCollapsed',
    default: true,
    advanced: true
  }, {
    name: 'directionTopEnabled',
    label: 'Top',
    type: 'checkbox',
    default: true,
    advanced: true
  }, {
    name: 'directionRightEnabled',
    label: 'Right',
    type: 'checkbox',
    default: true,
    advanced: true
  }, {
    name: 'directionBottomEnabled',
    label: 'Bottom',
    type: 'checkbox',
    default: true,
    advanced: true
  }, {
    name: 'directionLeftEnabled',
    label: 'Left',
    type: 'checkbox',
    default: true,
    advanced: true
  }, {
    type: 'section',
    label: 'Ambient light',
    name: 'sectionAmbientlightCollapsed',
    default: false
  }, {
    name: 'blur2',
    label: 'Blur',
    description: 'Uses: GPU memory',
    type: 'list',
    default: 30,
    min: 0,
    max: 100,
    step: 0.1
  }, {
    name: 'edge',
    label: 'Edge size',
    description: 'To better see what changes: Turn the blur to 0%',
    type: 'list',
    default: 12,
    min: 2,
    max: 50,
    step: 0.1,
    advanced: true
  }, {
    name: 'spread',
    label: 'Spread',
    description: 'Uses: GPU power',
    type: 'list',
    default: 17,
    min: 0,
    max: 400,
    step: 0.1
  }, {
    name: 'spreadFadeStart',
    label: 'Spread fade start',
    type: 'list',
    default: 15,
    min: -50,
    max: 100,
    step: 0.1,
    advanced: true
  }, {
    name: 'spreadFadeCurve',
    label: 'Spread fade curve',
    description: 'To better see what changes: Turn the blur to 0%',
    type: 'list',
    default: 35,
    min: 1,
    max: 100,
    step: 1,
    advanced: true
  }, {
    name: 'debandingStrength',
    label: 'Debanding (noise)',
    questionMark: {
      title: 'Click for more information about (noise /dithering).\nTip: Change the "Quality > Optimize debanding for" setting to "OLED" to retain pure blacks on OLED displays.',
      href: 'https://www.lifewire.com/what-is-dithering-4686105'
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    advanced: true
  }, {
    name: 'frameFading',
    label: 'Fade in duration',
    description: 'Uses: GPU memory',
    questionMark: {
      title: 'Fading between changes in the ambient light'
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 21.2,
    step: 0.02,
    manualinput: false
  }, {
    name: 'flickerReduction',
    label: 'Flicker reduction',
    questionMark: {
      title: 'Reduces flickering by limiting the speed at which brightness changes in the ambient light'
    },
    type: 'list',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    manualinput: false,
    advanced: true
  }, {
    name: 'frameBlending',
    label: 'Smooth motion (frame blending)',
    questionMark: {
      title: 'Click for more information about Frame blending',
      href: 'https://www.youtube.com/watch?v=m_wfO4fvH8M&t=81s'
    },
    description: 'Uses: GPU power. Also works with "Sync video"',
    type: 'checkbox',
    default: false,
    advanced: true
  }, {
    name: 'frameBlendingSmoothness',
    label: 'Smooth motion strength',
    type: 'list',
    default: 80,
    min: 0,
    max: 100,
    step: 1,
    advanced: true
  }, {
    name: 'fixedPosition',
    label: 'Fixed position',
    description: 'Ignores the scroll position of the page',
    type: 'checkbox',
    default: false,
    advanced: true
  }, {
    type: 'section',
    label: 'View modes',
    name: 'sectionViewsCollapsed',
    default: false
  }, {
    name: 'enableInViews',
    label: 'Enable in layouts',
    type: 'list',
    manualinput: false,
    default: 0,
    min: 0,
    max: 5,
    step: 1,
    snapPoints: [{
      value: 0,
      label: 'All'
    }, {
      value: 1,
      label: 'Small'
    }, {
      value: 2,
      hiddenLabel: 'Small & Theater'
    }, {
      value: 3,
      label: 'Theater'
    }, {
      value: 4,
      hiddenLabel: 'Theater & Fullscreen'
    }, {
      value: 5,
      label: 'Fullscreen'
    }]
  }, {
    name: 'enableInPictureInPicture',
    label: 'Picture in picture',
    type: 'checkbox',
    default: false,
    advanced: true
  }, {
    name: 'enableInEmbed',
    label: 'Embedded videos',
    type: 'checkbox',
    default: true,
    advanced: true
  }, {
    name: 'enableInVRVideos',
    label: 'VR/360 videos',
    type: 'checkbox',
    default: true,
    advanced: true
  }, {
    type: 'section',
    label: 'General',
    name: 'sectionGeneralCollapsed',
    default: false
  }, {
    name: 'theme',
    label: 'Appearance (theme)',
    type: 'list',
    manualinput: false,
    default: 1,
    min: -1,
    max: 1,
    step: 1,
    snapPoints: [{
      value: -1,
      label: 'Light'
    }, {
      value: 0,
      label: 'Default'
    }, {
      value: 1,
      label: 'Dark'
    }]
  }, {
    name: 'enabled',
    label: 'Enabled',
    type: 'checkbox',
    default: true,
    defaultKey: 'G'
  }];

  let settings;
  let version = '';
  const setVersion = newVersion => {
    version = newVersion;
  };
  let crashOptions = null;
  const setCrashOptions = newCrashOptions => {
    // Stored upstream opt-ins cannot enable telemetry in this distribution.
    crashOptions = { video: false, technical: false, crash: false };
  };
  // YLG privacy boundary: errors stay local. No client, transport, IDs or reports.
  class SentryReporter {
    static async captureException(ex) { console.error(ex); }
  }
  SentryReporter.script = globalThis.yt ? 'injected' : 'content';
  SentryReporter.overflowProtection = 0;

  const origin = 'https://www.youtube.com';
  const extensionId = 'youtube-ambient-light-extension';
  const isSameWindowMessage = event => event.source === window && event.origin === origin;

  class InjectedScript {
    constructor() {
      this.globalListener = void 0;
      this.listeners = [];
      this.addMessageListener = (type, handler) => {
        if (!this.globalListener) {
          this.globalListener = wrapErrorHandler(function injectedScriptMessageListenerGlobal(event) {
            if (!event.detail || typeof event.detail !== 'string') return;
            const detail = JSON.parse(event.detail);
            if (!isSameWindowMessage || (detail === null || detail === void 0 ? void 0 : detail.injectedScript) !== extensionId || !(detail !== null && detail !== void 0 && detail.type)) return;
            for (const listener of this.listeners) {
              listener(detail);
            }
          }.bind(this), true);
          document.addEventListener('ytal-message', this.globalListener);
        }
        const listener = wrapErrorHandler(function injectedScriptMessageListener(detail) {
          if (detail.type !== type) return;
          handler(detail === null || detail === void 0 ? void 0 : detail.message);
        }.bind(this), true);
        this.listeners.push(listener);
        return listener;
      };
      this.removeMessageListener = listener => {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) {
          this.listeners.splice(index, 1);
        }
        if (this.globalListener && this.listeners.length === 0) {
          document.removeEventListener('ytal-message', this.globalListener);
          this.globalListener = undefined;
        }
      };
      this.receiveMessage = (type, timeout = 3000) => new Promise(function receiveMessagePromise(resolve, reject) {
        try {
          const receivedMessage = function reveicedMessage(message) {
            clearTimeout(timeoutId);
            injectedScript.removeMessageListener(changedListener);
            resolve(message);
          }.bind(this);
          const receiveMessageTimeout = function receiveMessageTimeout() {
            console.warn(`Never received a response message for "${type}" after ${timeout}ms`);
            receivedMessage();
          }.bind(this);
          const timeoutId = setTimeout(receiveMessageTimeout, timeout);
          const changedListener = injectedScript.addMessageListener(type, receivedMessage);
        } catch (ex) {
          reject(ex);
        }
      });
      this.postAndReceiveMessage = async (type, message, timeout) => {
        const receiveMessagePromise = this.receiveMessage(type, timeout);
        this.postMessage(type, message);
        return await receiveMessagePromise;
      };
    }
    postMessage(type, message) {
      const event = new CustomEvent('ytal-message', {
        detail: JSON.stringify({
          type,
          message,
          contentScript: extensionId
        })
      });
      return document.dispatchEvent(event);
    }
  }
  const injectedScript = new InjectedScript();

  setErrorHandler(ex => SentryReporter.captureException(ex));
  let resolveLoaderReady;
  window.__YLG_AMBIENT_LOADER_RELEASED__ = false;
  window.__YLG_AMBIENT_LOADER_READY__ = new Promise(resolve => {
    resolveLoaderReady = resolve;
  });
  wrapErrorHandler(async function loadContentScript() {
    // Settings/migration must finish before upstream reads its cached options.
    // Disabled startup waits here; enabling releases this same loader once.
    await window.YLG_AMBIENT_VENDOR.waitUntilEnabled();
    // Native MV3 content_scripts (including world: "MAIN") replaced legacy cross-origin injections:
    // chrome.runtime.getURL('vendor/ambient/content.css'), chrome.runtime.getURL('vendor/ambient/injected.js'),
    // and await import(scriptUrl).
    injectedScript.addMessageListener('error', injectedEx => {
      const ex = new Error(injectedEx.message);
      ex.name = injectedEx.name;
      ex.stack = injectedEx.stack;
      if (injectedEx.details) ex.details = injectedEx.details;
      SentryReporter.captureException(ex);
    });
    const version = getVersion();
    setVersion(version);
    let crashOptions = defaultCrashOptions;
    try {
      crashOptions = (await storage.get('crashOptions')) || defaultCrashOptions;
      setCrashOptions(crashOptions);
    } catch (ex) {
      SentryReporter.captureException(ex);
    }
    storage.addListener(function storageListener(changes) {
      var _changes$crashOptions;
      if (!((_changes$crashOptions = changes.crashOptions) !== null && _changes$crashOptions !== void 0 && _changes$crashOptions.newValue)) return;
      const crashOptions = changes.crashOptions.newValue;
      setCrashOptions(crashOptions);
    });
    window.__YLG_AMBIENT_LOADER_RELEASED__ = true;
    resolveLoaderReady(true);
  })();

})();
