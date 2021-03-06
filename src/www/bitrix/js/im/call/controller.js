;(function()
{
	BX.namespace("BX.Call");
	if(BX.Call.Controller)
	{
		return;
	}

	var USER_LIMIT_FOR_HD = 5;

	BX.Call.Controller = function(config)
	{
		this.messenger = config.messenger;

		this.container = null;

		this.folded = false;

		/** @var {BX.Call.PlainCall|BX.Call.VoximplantCall} this.currentCall */
		this.currentCall = null;
		this.childCall = null;
		this.callView = null;
		this.callNotification = null;
		this.invitePopup = null;
		/** @var {BX.Call.VideoStrategy} this.currentCall */
		this.videoStrategy = null;

		this.isHttps = window.location.protocol === "https:";
		this.callWithMobile = false;

		this.autoCloseCallView = true;

		this.talkingUsers = {};

		// event handlers
		this._onCallUserInvitedHandler = this._onCallUserInvited.bind(this);
		this._onCallDestroyHandler = this._onCallDestroy.bind(this);
		this._onCallUserStateChangedHandler = this._onCallUserStateChanged.bind(this);
		this._onCallUserMicrophoneStateHandler = this._onCallUserMicrophoneState.bind(this);
		this._onCallLocalMediaReceivedHandler = this._onCallLocalMediaReceived.bind(this);
		this._onCallLocalMediaStoppedHandler = this._onCallLocalMediaStopped.bind(this);
		this._onCallUserStreamReceivedHandler = this._onCallUserStreamReceived.bind(this);
		this._onCallUserStreamRemovedHandler = this._onCallUserStreamRemoved.bind(this);
		this._onCallUserVoiceStartedHandler = this._onCallUserVoiceStarted.bind(this);
		this._onCallUserVoiceStoppedHandler = this._onCallUserVoiceStopped.bind(this);
		this._onCallUserScreenStateHandler = this._onCallUserScreenState.bind(this);
		this._onCallFailureHandler = this._onCallFailure.bind(this);
		this._onCallLeaveHandler = this._onCallLeave.bind(this);
		this._onCallJoinHandler = this._onCallJoin.bind(this);

		this._onBeforeUnloadHandler = this._onBeforeUnload.bind(this);
		this._onImTabChangeHandler = this._onImTabChange.bind(this);
		this._onUpdateChatCounterHandler = this._onUpdateChatCounter.bind(this);


		this._onChildCallFirstStreamHandler = this._onChildCallFirstStream.bind(this);

		this._onWindowFocusHandler = this._onWindowFocus.bind(this);
		this._onWindowBlurHandler = this._onWindowBlur.bind(this);

		if(BX.desktop && false)
		{
			this.floatingWindow = new BX.Call.FloatingVideo({
				onMainAreaClick: this._onFloatingVideoMainAreaClick.bind(this),
				onButtonClick: this._onFloatingVideoButtonClick.bind(this)
			});
			this.floatingWindowUser = 0;
		}
		this.showFloatingWindowTimeout = 0;
		this.hideIncomingCallTimeout = 0;

		this.init();
	};

	BX.Call.Controller.prototype = {
		init: function()
		{
			BX.addCustomEvent(window, "CallEvents::incomingCall", this.onIncomingCall.bind(this));
			BX.addCustomEvent(BX.Call.Hardware, "HardwareManager::deviceChange", this._onDeviceChange.bind(this));

			if(BX.desktop && this.floatingWindow)
			{
				window.addEventListener("blur", this._onWindowBlurHandler);
				window.addEventListener("focus", this._onWindowFocusHandler);

				BX.desktop.addCustomEvent("BXForegroundChanged", function(focus)
				{
					if(focus)
					{
						this._onWindowFocus();
					}
					else
					{
						this._onWindowBlur();
					}
				}.bind(this));
			}

			if(window['VoxImplant'])
			{
				VoxImplant.getInstance().addEventListener(VoxImplant.Events.MicAccessResult, this.voxMicAccessResult.bind(this));
			}

			window.addEventListener("beforeunload", this._onBeforeUnloadHandler);
			BX.addCustomEvent("OnDesktopTabChange", this._onImTabChangeHandler);

			BX.addCustomEvent(window, "onImUpdateCounterMessage", this._onUpdateChatCounter.bind(this));

			BX.garbage(this.destroy, this);
		},

		/**
		 * Workaround to get current microphoneId
		 * @param e
		 */
		voxMicAccessResult: function(e)
		{
			if(e.stream && e.stream.getAudioTracks().length > 0 && this.callView)
			{
				this.callView.microphoneId = e.stream.getAudioTracks()[0].getSettings().deviceId
			}
		},

		getCallUsers: function(includeSelf)
		{
			var result = Object.keys(this.currentCall.getUsers());
			if(includeSelf)
			{
				result.push(this.currentCall.userId);
			}
			return result;
		},

		getActiveCallUsers: function()
		{
			var activeUsers = [];
			var userStates = this.currentCall.getUsers();

			for (var userId in userStates)
			{
				if(userStates.hasOwnProperty(userId))
				{
					if(userStates[userId] === BX.Call.UserState.Connected || userStates[userId] === BX.Call.UserState.Connecting || userStates[userId] === BX.Call.UserState.Calling)
					{
						activeUsers.push(userId);
					}
				}
			}
			return activeUsers;
		},

		updateFloatingWindowContent: function()
		{
			if(!this.floatingWindow || !this.currentCall)
			{
				return;
			}
			this.floatingWindow.setTitle(this.currentCall.associatedEntity.name);

			BX.Call.Util.getUserAvatars(this.currentCall.id, this.getActiveCallUsers()).then(function(result)
			{
				this.floatingWindow.setAvatars(result);
			}.bind(this));
		},

		onIncomingCall: function(e)
		{
			console.warn("incoming.call");
			var self = this;
			/** @var {BX.Call.PlainCall|BX.Call.VoximplantCall} newCall */
			var newCall = e.call;
			this.callWithMobile = (e.isMobile === true);

			var isCurrentCallActive = this.currentCall && (this.callView || this.callNotification);

			if(!isCurrentCallActive)
			{
				if(this.callView)
				{
					return;
				}

				this.checkDesktop().then(function()
				{
					 return BX.Call.Hardware.init();
				}).then(
					function()
					{
						this.currentCall = newCall;
						this.bindCallEvents();
						this.updateFloatingWindowContent();

						if(this.currentCall.associatedEntity.type === 'chat' && this.currentCall.associatedEntity.advanced['chatType'] === 'videoconf')
						{
							this.isConferencePageOpened(this.currentCall.associatedEntity.id).then(function(result)
							{
								if(result)
								{
									// conference page is already opened, do nothing
									this.removeCallEvents();
									this.currentCall = null;
								}
								else
								{
									this.showIncomingConference();
								}
							}.bind(this));
						}
						else
						{
							var video = e.video === true;
							if(video && !BX.Call.Hardware.hasCamera())
							{
								this.showNotification(BX.message('IM_CALL_ERROR_NO_CAMERA'));
								video = false;
							}

							this.showIncomingCall({
								video: video
							});
						}

					}.bind(this),
					function(error)
					{
						if(self.currentCall)
						{
							self.removeVideoStrategy();
							self.removeCallEvents();
							self.currentCall = null;
						}
						console.error(error);
						self.log(error);
						if(!self.isHttps)
						{
							self.showNotification(BX.message("IM_CALL_INCOMING_ERROR_HTTPS_REQUIRED"))
						}
						else
						{
							self.showNotification(BX.message("IM_CALL_INCOMING_UNSUPPORTED_BROWSER"))
						}
					}
				);
			}
			else
			{
				if(newCall.id == this.currentCall.id)
				{
					// ignoring
				}
				else if(newCall.parentId == this.currentCall.id)
				{
					if(!this.childCall)
					{
						this.childCall = newCall;
						this.childCall.users.forEach(function(userId)
						{
							this.callView.addUser(userId, BX.Call.UserState.Calling);
						}, this);

						this.answerChildCall();
					}
				}
				else
				{
					// send busy
					newCall.decline(486);
					return false;
				}
			}
		},

		bindCallEvents: function()
		{
			this.currentCall.addEventListener(BX.Call.Event.onUserInvited, this._onCallUserInvitedHandler);
			this.currentCall.addEventListener(BX.Call.Event.onDestroy, this._onCallDestroyHandler);
			this.currentCall.addEventListener(BX.Call.Event.onUserStateChanged, this._onCallUserStateChangedHandler);
			this.currentCall.addEventListener(BX.Call.Event.onUserMicrophoneState, this._onCallUserMicrophoneStateHandler);
			this.currentCall.addEventListener(BX.Call.Event.onUserScreenState, this._onCallUserScreenStateHandler);
			this.currentCall.addEventListener(BX.Call.Event.onLocalMediaReceived, this._onCallLocalMediaReceivedHandler);
			this.currentCall.addEventListener(BX.Call.Event.onLocalMediaStopped, this._onCallLocalMediaStoppedHandler);
			this.currentCall.addEventListener(BX.Call.Event.onStreamReceived, this._onCallUserStreamReceivedHandler);
			this.currentCall.addEventListener(BX.Call.Event.onStreamRemoved, this._onCallUserStreamRemovedHandler);
			this.currentCall.addEventListener(BX.Call.Event.onUserVoiceStarted, this._onCallUserVoiceStartedHandler);
			this.currentCall.addEventListener(BX.Call.Event.onUserVoiceStopped, this._onCallUserVoiceStoppedHandler);
			this.currentCall.addEventListener(BX.Call.Event.onCallFailure, this._onCallFailureHandler);
			this.currentCall.addEventListener(BX.Call.Event.onJoin, this._onCallJoinHandler);
			this.currentCall.addEventListener(BX.Call.Event.onLeave, this._onCallLeaveHandler);
		},

		removeCallEvents: function()
		{
			this.currentCall.removeEventListener(BX.Call.Event.onUserInvited, this._onCallUserInvitedHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onDestroy, this._onCallDestroyHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onUserStateChanged, this._onCallUserStateChangedHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onUserMicrophoneState, this._onCallUserMicrophoneStateHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onUserScreenState, this._onCallUserScreenStateHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onLocalMediaReceived, this._onCallLocalMediaReceivedHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onLocalMediaStopped, this._onCallLocalMediaStoppedHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onStreamReceived, this._onCallUserStreamReceivedHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onStreamRemoved, this._onCallUserStreamRemovedHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onUserVoiceStarted, this._onCallUserVoiceStartedHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onUserVoiceStopped, this._onCallUserVoiceStoppedHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onCallFailure, this._onCallFailureHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onJoin, this._onCallJoinHandler);
			this.currentCall.removeEventListener(BX.Call.Event.onLeave, this._onCallLeaveHandler);
		},

		bindCallViewEvents: function()
		{
			this.callView.setCallback('onClose', this._onCallViewClose.bind(this));
			this.callView.setCallback('onDestroy', this._onCallViewDestroy.bind(this));
			this.callView.setCallback('onButtonClick', this._onCallViewButtonClick.bind(this));
			this.callView.setCallback('onBodyClick', this._onCallViewBodyClick.bind(this));
			this.callView.setCallback('onReplaceCamera', this._onCallViewReplaceCamera.bind(this));
			this.callView.setCallback('onReplaceMicrophone', this._onCallViewReplaceMicrophone.bind(this));
			this.callView.setCallback('onReplaceSpeaker', this._onCallViewReplaceSpeaker.bind(this));
			this.callView.setCallback('onSetCentralUser', this._onCallViewSetCentralUser.bind(this));
		},

		createVideoStrategy: function()
		{
			if (this.videoStrategy)
			{
				this.videoStrategy.destroy();
			}

			var strategyType = window.BXIM.settings.callAcceptIncomingVideo || BX.Call.VideoStrategy.Type.AllowAll;

			this.videoStrategy = new BX.Call.VideoStrategy({
				call: this.currentCall,
				callView: this.callView,
				strategyType: strategyType
			});
		},

		removeVideoStrategy: function()
		{
			if (this.videoStrategy)
			{
				this.videoStrategy.destroy();
			}
			this.videoStrategy = null;
		},

		setVideoStrategyType: function(type)
		{
			if(this.videoStrategy)
			{
				this.videoStrategy.setType(type)
			}
		},

		isMessengerOpen: function()
		{
			return !!this.messenger.popupMessenger;
		},

		createContainer: function()
		{
			this.container = BX.create("div", {
				props: {className: "bx-messenger-call-overlay"},
			});

			if(BX.MessengerWindow)
			{
				BX.MessengerWindow.content.insertBefore(this.container, BX.MessengerWindow.content.firstChild);
			}
			else
			{
				this.messenger.popupMessengerContent.insertBefore(this.container, this.messenger.popupMessengerContent.firstChild);
			}

			this.messenger.popupMessengerContent.classList.add("bx-messenger-call");
		},

		resize: function()
		{

		},

		answerChildCall: function()
		{
			this.removeCallEvents();
			this.removeVideoStrategy();
			this.childCall.addEventListener(BX.Call.Event.onStreamReceived, this._onChildCallFirstStreamHandler);
			this.childCall.addEventListener(BX.Call.Event.onLocalMediaReceived, this._onCallLocalMediaReceivedHandler);

			this.childCall.answer({
				useVideo: this.currentCall.isVideoEnabled()
			});
		},

		_onChildCallFirstStream: function(e)
		{
			this.log("Finishing one-to-one call, switching to group call");
			this.callView.setStream(e.userId, e.stream);
			this.childCall.removeEventListener(BX.Call.Event.onStreamReceived, this._onChildCallFirstStreamHandler);

			this.removeCallEvents();
			var oldCall = this.currentCall;
			oldCall.hangup();

			this.currentCall = this.childCall;
			this.childCall = null;

			if(this.currentCall.associatedEntity && this.currentCall.associatedEntity.id)
			{
				this.messenger.openMessenger(this.currentCall.associatedEntity.id);
			}

			if(oldCall.muted)
			{
				this.currentCall.setMuted(true);
			}

			this.bindCallEvents();
			this.createVideoStrategy();
		},

		checkDesktop: function()
		{
			return new Promise(function(resolve)
			{
				BX.desktopUtils.runningCheck(
					function(){},
					function()
					{
						resolve()
					}
				);
			});
		},

		isConferencePageOpened: function(dialogId)
		{
			return new Promise(function(resolve, reject)
			{
				var tagPresent = BX.Messenger.Lib.LocalStorage.get(BX.CallEngine.getSiteId(), BX.CallEngine.getCurrentUserId(), BX.CallEngine.getConferencePageTag(dialogId), 'N');
				return resolve(tagPresent === 'Y');
			}.bind(this))
		},

		/**
		 * @param {Object} params
		 * @param {bool} [params.video = false]
		 */
		showIncomingCall: function(params)
		{
			if(!BX.type.isPlainObject(params))
			{
				params = {};
			}
			params.video = params.video == true;

			var allowVideo = this.callWithMobile ? params.video === true : true;

			this.callNotification = new BX.Call.Notification({
				callerName: this.currentCall.associatedEntity.name,
				callerAvatar: this.currentCall.associatedEntity.avatar,
				video: params.video,
				hasCamera: BX.Call.Hardware.hasCamera() && allowVideo,
				onClose: this._onCallNotificationClose.bind(this),
				onDestroy: this._onCallNotificationDestroy.bind(this),
				onButtonClick: this._onCallNotificationButtonClick.bind(this)
			}) ;

			this.callNotification.show();
			this.scheduleCancelNotification();

			window.BXIM.repeatSound('ringtone', 3500, true);
		},

		showIncomingConference: function()
		{
			this.callNotification = new BX.Call.NotificationConference({
				callerName: this.currentCall.associatedEntity.name,
				callerAvatar: this.currentCall.associatedEntity.avatar,
				onClose: this._onCallNotificationClose.bind(this),
				onDestroy: this._onCallNotificationDestroy.bind(this),
				onButtonClick: this._onCallConferenceNotificationButtonClick.bind(this)
			}) ;

			this.callNotification.show();
			this.scheduleCancelNotification();

			console.warn("play sound")
			window.BXIM.repeatSound('ringtone', 3500, true);
		},

		scheduleCancelNotification: function()
		{
			clearTimeout(this.hideIncomingCallTimeout);
			this.hideIncomingCallTimeout = setTimeout(function()
			{
				if(this.callNotification)
				{
					this.callNotification.close();
				}
				if(this.currentCall)
				{
					this.removeVideoStrategy();
					this.removeCallEvents();
					this.currentCall = null;
				}
			}.bind(this), 30 * 1000);
		},

		showNotification: function(notificationText)
		{
			BX.UI.Notification.Center.notify({
				content: BX.util.htmlspecialchars(notificationText),
				position: "top-right",
				autoHideDelay: 5000,
				closeButton: true
			});
		},

		showUnsupportedNotification: function()
		{
			if (BX.desktop && BX.desktop.apiReady)
			{
				window.BXIM.openConfirm(
					BX.message('IM_CALL_DESKTOP_TOO_OLD'),
					[
						updateButton = new BX.PopupWindowButton({
							text: BX.message('IM_M_CALL_BTN_UPDATE'),
							className: "popup-window-button-accept",
							events: {
								click: function ()
								{
									window.open(BX.browser.IsMac() ? "http://dl.bitrix24.com/b24/bitrix24_desktop.dmg": "http://dl.bitrix24.com/b24/bitrix24_desktop.exe", "desktopApp");
									this.popupWindow.close();
								}
							}
						}),
						new BX.PopupWindowButton({
							text: BX.message('IM_NOTIFY_CONFIRM_CLOSE'),
							className: "popup-window-button-decline",
							events: {
								click: function ()
								{
									this.popupWindow.close();
								}
							}
						})
					]
				);
			}
			else
			{
				window.BXIM.openConfirm(
					BX.message("IM_CALL_WEBRTC_USE_CHROME_OR_DESKTOP"),
					[
						new BX.PopupWindowButton({
							text: BX.message("IM_CALL_DETAILS"),
							className: "popup-window-button-accept",
							events: {
								click: function ()
								{
									this.popupWindow.close();
									//https://helpdesk.bitrix24.ru/open/11387752/
									top.BX.Helper.show("redirect=detail&code=11387752");
								}
							}
						}),
						new BX.PopupWindowButton({
							text: BX.message('IM_NOTIFY_CONFIRM_CLOSE'),
							className: "popup-window-button-decline",
							events: {
								click: function ()
								{
									this.popupWindow.close();
								}
							}
						}),
					]
				);
			}
		},

		isUserAgentSupported: function()
		{
			if (BX.desktop && BX.desktop.apiReady)
			{
				return BX.desktop.enableInVersion(48);
			}
			if ('VoxImplant' in window)
			{
				return VoxImplant.getInstance().isRTCsupported();
			}
			return BX.Call.Util.isWebRTCSupported();
		},

		startCall: function(dialogId, video)
		{
			if(!this.isUserAgentSupported())
			{
				this.showUnsupportedNotification();
				return;
			}

			if(this.callView || this.currentCall)
			{
				return;
			}

			var provider = BX.Call.Provider.Plain;
			if(BX.Call.Util.isCallServerAllowed() && dialogId.toString().substr(0, 4) === "chat")
			{
				provider = BX.Call.Provider.Voximplant;
			}

			var debug1 = +(new Date());
			this._openMessenger(dialogId).then(function()
			{
				return BX.Call.Hardware.init();
			}.bind(this)).then(function()
			{
				this.createContainer();

				this.callView = new BX.Call.View({
					container: this.container,
					showChatButtons: true,
					userLimit: BX.Call.Util.getUserLimit(),
					language: window.BXIM.language,
					layout: dialogId.toString().startsWith("chat") ? BX.Call.View.Layout.Grid : BX.Call.View.Layout.Centered,
					microphoneId: BX.Call.Hardware.defaultMicrophone
				});
				this.bindCallViewEvents();

				if(video && !BX.Call.Hardware.hasCamera())
				{
					this.showNotification(BX.message('IM_CALL_ERROR_NO_CAMERA'));
					video = false;
				}

				return BX.Call.Engine.getInstance().createCall({
					entityType: 'chat',
					entityId: dialogId,
					provider: provider,
					videoEnabled: !!video,
					enableMicAutoParameters: BX.Call.Hardware.enableMicAutoParameters,
					joinExisting: dialogId.toString().startsWith("chat")
				});
			}.bind(this)).then(function(e)
			{
				var debug2 = +(new Date());
				this.currentCall = e.call;

				this.log("Call creation time: " + (debug2 - debug1) / 1000 + " seconds");

				this.currentCall.useHdVideo(BX.Call.Hardware.preferHdQuality);
				if(BX.Call.Hardware.defaultMicrophone)
				{
					this.currentCall.setMicrophoneId(BX.Call.Hardware.defaultMicrophone);
				}
				if(BX.Call.Hardware.defaultCamera)
				{
					this.currentCall.setCameraId(BX.Call.Hardware.defaultCamera);
				}

				if(this.currentCall.associatedEntity && this.currentCall.associatedEntity.id)
				{
					if(this.messenger.currentTab != this.currentCall.associatedEntity.id)
					{
						this.messenger.openMessenger(this.currentCall.associatedEntity.id);
					}
				}

				this.autoCloseCallView = true;
				this.bindCallEvents();
				this.createVideoStrategy();

				this.callView.appendUsers(this.currentCall.getUsers());
				BX.Call.Util.getUsers(this.currentCall.id, this.getCallUsers(true)).then(function(userData) {
					this.callView.updateUserData(userData)
				}.bind(this));
				this.callView.show();

				if (e.isNew)
				{
					this.log("Inviting users");
					this.currentCall.inviteUsers();
					window.BXIM.repeatSound('dialtone', 5000, true);
				}
				else
				{
					this.log("Joining existing call");
					this.currentCall.answer({
						useVideo: video
					});
				}
			}.bind(this)).catch(function(error)
			{
				console.error(error);

				var errorCode;
				if (typeof(error) == "string")
				{
					errorCode = error;
				}
				else if (typeof(error) == "object" && error.code)
				{
					errorCode = error.code == 'access_denied' ? 'ACCESS_DENIED' : error.code
				}
				else
				{
					errorCode = 'UNKNOWN_ERROR';
				}
				this._onCallFailure({
					code: errorCode,
					message: error.message || "",
				})

			}.bind(this));
		},

		joinCall: function(callId, video)
		{
			if(!this.isUserAgentSupported())
			{
				this.showUnsupportedNotification();
				return;
			}

			if(this.callView || this.currentCall)
			{
				return;
			}

			var isGroupCall;

			this.log("Joining call " + callId);
			BX.CallEngine.getCallWithId(callId).then(function(result)
			{
				this.currentCall = result.call;
				isGroupCall = this.currentCall.associatedEntity.id.toString().startsWith("chat");
				return this.messenger.openMessenger();
			}.bind(this)).then(function()
			{
				return BX.Call.Hardware.init();
			}.bind(this)).then(function()
			{
				this.createContainer();

				this.callView = new BX.Call.View({
					container: this.container,
					showChatButtons: true,
					userLimit: BX.Call.Util.getUserLimit(),
					language: window.BXIM.language,
					layout: isGroupCall ? BX.Call.View.Layout.Grid : BX.Call.View.Layout.Centered,
					microphoneId: BX.Call.Hardware.defaultMicrophone
				});
				this.autoCloseCallView = true;
				this.bindCallViewEvents();
				this.callView.appendUsers(this.currentCall.getUsers());
				BX.Call.Util.getUsers(this.currentCall.id, this.getCallUsers(true)).then(function(userData) {
					this.callView.updateUserData(userData)
				}.bind(this));
				this.callView.show();

				this.currentCall.useHdVideo(BX.Call.Hardware.preferHdQuality);
				if(BX.Call.Hardware.defaultMicrophone)
				{
					this.currentCall.setMicrophoneId(BX.Call.Hardware.defaultMicrophone);
				}
				if(BX.Call.Hardware.defaultCamera)
				{
					this.currentCall.setCameraId(BX.Call.Hardware.defaultCamera);
				}

				this.bindCallEvents();
				this.createVideoStrategy();

				if(video && !BX.Call.Hardware.hasCamera())
				{
					this.showNotification(BX.message('IM_CALL_ERROR_NO_CAMERA'));
					video = false;
				}

				this.currentCall.answer({
					useVideo: !!video
				});
			}.bind(this));
		},

		leaveCurrentCall: function()
		{
			if(this.callView)
			{
				this.callView.releaseLocalMedia();
			}

			if(this.currentCall)
			{
				this.currentCall.hangup();
			}
			if(this.callView)
			{
				this.callView.close();
			}
		},

		hasActiveCall: function()
		{
			return (this.currentCall != null && this.currentCall.isAnyoneParticipating()) || (this.callView != null);
		},

		hasVisibleCall: function()
		{
			return !!(this.callView && this.callView.visible && this.callView.size == BX.Call.View.Size.Full);
		},

		useDevicesInCurrentCall: function(deviceList)
		{
			if(!this.currentCall || !this.currentCall.ready)
			{
				return;
			}

			for (var i = 0; i < deviceList.length; i++)
			{
				var deviceInfo = deviceList[i];

				switch (deviceInfo.kind)
				{
					case "audioinput":
						this.currentCall.setMicrophoneId(deviceInfo.deviceId);
						break;
					case "videoinput":
						this.currentCall.setCameraId(deviceInfo.deviceId);
						break;
					case "audiooutput":
						if(this.callView)
						{
							this.callView.setSpeakerId(deviceInfo.deviceId);
						}
						break;
				}
			}
		},

		removeDevicesFromCurrentCall: function(deviceList)
		{
			if(!this.currentCall || !this.currentCall.ready)
			{
				return;
			}

			for (var i = 0; i < deviceList.length; i++)
			{
				var deviceInfo = deviceList[i];

				switch (deviceInfo.kind)
				{
					case "audioinput":
						if(this.currentCall.microphoneId == deviceInfo.deviceId)
						{
							this.currentCall.setMicrophoneId("");
						}
						break;
					case "videoinput":
						if(this.currentCall.cameraId == deviceInfo.deviceId)
						{
							this.currentCall.setCameraId("");
						}
						break;
					case "audiooutput":
						if(this.callView && this.callView.speakerId == deviceInfo.deviceId)
						{
							this.callView.setSpeakerId("");
						}
						break;
				}
			}
		},

		showChat: function()
		{
			if(BX.desktop && this.floatingWindow)
			{
				this.detached = true;
				this.callView.hide();
				this.floatingWindow.setTitle(this.currentCall.associatedEntity.name);
				BX.Call.Util.getUserAvatars(this.currentCall.id, this.getActiveCallUsers()).then(function(result)
				{
					this.floatingWindow.setAvatars(result);
					this.floatingWindow.show();
				}.bind(this));

				this.container.style.width = 0;
			}
			else
			{
				this.fold();
			}
		},

		fold: function()
		{
			if(this.folded || (BX.desktop && this.floatingWindow))
			{
				return;
			}

			this.folded = true;
			this.container.classList.add('bx-messenger-call-overlay-folded');
			this.callView.setTitle(this.currentCall.associatedEntity.name);
			this.callView.setSize(BX.Call.View.Size.Folded);
			BX.onCustomEvent(this, "CallController::onFold", {});
		},

		unfold: function()
		{
			if(this.detached)
			{
				this.container.style.removeProperty('width');
				this.callView.show();
				this.detached = false;
				if(this.floatingWindow)
				{
					this.floatingWindow.hide();
				}
			}
			if(this.folded)
			{
				this.folded = false;
				this.container.classList.remove('bx-messenger-call-overlay-folded');
				this.callView.setSize(BX.Call.View.Size.Full);
			}
			BX.onCustomEvent(this, "CallController::onUnfold", {});
		},

		// converter from BX.Promise to normal Promise
		_openMessenger: function(dialogId)
		{
			return new Promise(function (resolve, reject)
			{
				this.messenger.openMessenger(dialogId).then(function()
				{
					resolve();
				}).catch(function(e)
				{
					reject(e);
				})
			}.bind(this))
		},

		// event handlers

		_onCallNotificationClose: function(e)
		{
			clearTimeout(this.hideIncomingCallTimeout);
			window.BXIM.stopRepeatSound('ringtone');
			if(this.callNotification)
			{
				this.callNotification.destroy();
			}
		},

		_onCallNotificationDestroy: function(e)
		{
			this.callNotification = null;
		},

		_onCallNotificationButtonClick: function(e)
		{
			clearTimeout(this.hideIncomingCallTimeout);
			this.callNotification.close();
			switch (e.button)
			{
				case "answer":
					if(BX.desktop)
					{
						BX.desktop.windowCommand("show");
					}

					if(!this.isUserAgentSupported())
					{
						this.log("Error: unsupported user agent");
						this.removeVideoStrategy();
						this.removeCallEvents();
						this.currentCall.decline();
						this.currentCall = null;

						this.showUnsupportedNotification();
						return;
					}

					if(this.callView)
					{
						this.callView.destroy();
					}

					var dialogId = this.currentCall.associatedEntity && this.currentCall.associatedEntity.id ? this.currentCall.associatedEntity.id : false;
					var isGroupCall = dialogId.toString().startsWith("chat");
					this.messenger.openMessenger(dialogId).then(function()
					{
						this.createContainer();
						this.callView = new BX.Call.View({
							container: this.container,
							users: this.currentCall.users,
							userStates: this.currentCall.getUsers(),
							showChatButtons: true,
							userLimit: BX.Call.Util.getUserLimit(),
							layout: isGroupCall ? BX.Call.View.Layout.Grid : BX.Call.View.Layout.Centered,
							microphoneId: BX.Call.Hardware.defaultMicrophone
						});
						this.autoCloseCallView = true;
						if(this.callWithMobile)
						{
							this.callView.disableAddUser();
						}

						this.bindCallViewEvents();
						BX.Call.Util.getUsers(this.currentCall.id, this.getCallUsers(true)).then(function(userData) {
							this.callView.updateUserData(userData)
						}.bind(this));
						this.callView.show();

						this.currentCall.useHdVideo(BX.Call.Hardware.preferHdQuality);
						if(BX.Call.Hardware.defaultMicrophone)
						{
							this.currentCall.setMicrophoneId(BX.Call.Hardware.defaultMicrophone);
						}
						if(BX.Call.Hardware.defaultCamera)
						{
							this.currentCall.setCameraId(BX.Call.Hardware.defaultCamera);
						}

						this.currentCall.answer({
							useVideo: e.video,
							enableMicAutoParameters: BX.Call.Hardware.enableMicAutoParameters
						});
						this.createVideoStrategy();

					}.bind(this));

					break;
				case "decline":
					if(this.currentCall)
					{
						this.removeVideoStrategy();
						this.removeCallEvents();
						this.currentCall.decline();
						this.currentCall = null;
					}
					break;
			}
		},

		_onCallConferenceNotificationButtonClick: function(e)
		{
			clearTimeout(this.hideIncomingCallTimeout);
			this.callNotification.close();
			switch (e.button)
			{
				case "answerConference":
					if(this.currentCall)
					{
						this.currentCall.sendAnswer();
						BXIM.messenger.openVideoconf(this.currentCall.associatedEntity.id);
					}
					break;
				case "skipConference":
					if(this.currentCall)
					{
						this.removeVideoStrategy();
						this.removeCallEvents();
						this.currentCall.decline();
						this.currentCall = null;
					}
					break;
			}
		},

		_onCallViewClose: function(e)
		{
			this.callView.destroy();
			if(this.floatingWindow)
			{
				this.floatingWindow.close();
			}
		},

		_onCallViewDestroy: function(e)
		{
			if(this.messenger.popupMessengerContent)
			{
				BX.remove(this.container);
			}

			this.messenger.popupMessengerContent.classList.remove("bx-messenger-call");

			this.container = null;
			this.callView = null;
			this.folded = false;
			this.autoCloseCallView = true;

			if(this.currentCall)
			{
				this.currentCall.hangup();
			}
		},

		_onCallViewBodyClick: function(e)
		{
			if(this.folded)
			{
				this.unfold();
			}
		},

		_onCallViewButtonClick: function(e)
		{
			var buttonName = e.buttonName;

			var handlers = {
				hangup: this._onCallViewHangupButtonClick.bind(this),
				close: this._onCallViewCloseButtonClick.bind(this),
				inviteUser: this._onCallViewInviteUserButtonClick.bind(this),
				toggleMute: this._onCallViewToggleMuteButtonClick.bind(this),
				toggleScreenSharing: this._onCallViewToggleScreenSharingButtonClick.bind(this),
				toggleVideo: this._onCallViewToggleVideoButtonClick.bind(this),
				showChat: this._onCallViewShowChatButtonClick.bind(this),
				showHistory: this._onCallViewShowHistoryButtonClick.bind(this),
				fullscreen: this._onCallViewFullScreenButtonClick.bind(this),
			};

			if(BX.type.isFunction(handlers[buttonName]))
			{
				handlers[buttonName].call(this, e);
			}
		},

		_onCallViewHangupButtonClick: function(e)
		{
			this.leaveCurrentCall();
		},

		_onCallViewCloseButtonClick: function(e)
		{
			if(this.callView)
			{
				this.callView.close();
			}
		},

		_onCallViewShowChatButtonClick: function(e)
		{
			this.messenger.openMessenger(this.currentCall.associatedEntity.id);
			this.showChat();
		},

		/**
		 * Returns list of users, that are not currently connected
		 * @return {Array}
		 * @private
		 */
		_getDisconnectedUsers: function()
		{
			var result = [];
			var userStates = this.currentCall.getUsers();

			for(var userId in userStates)
			{
				if(userStates[userId] !== BX.Call.UserState.Connected && BX.Call.Util.userData[userId])
				{
					result.push(BX.Call.Util.userData[userId]);
				}
			}

			return result;
		},

		_onCallViewInviteUserButtonClick: function(e)
		{
			if(this.invitePopup)
			{
				this.invitePopup.close();
				return;
			}

			var userStates = this.currentCall.getUsers();
			var idleUsers = this._getDisconnectedUsers();

			this.invitePopup = new BX.Call.InvitePopup({
				bindElement: e.node,
				zIndex: BX.MessengerCommon.getDefaultZIndex() + 200,
				idleUsers: idleUsers,
				allowNewUsers: Object.keys(userStates).length < BX.Call.Util.getUserLimit() - 1,
				onDestroy: this._onInvitePopupDestroy.bind(this),
				onSelect: this._onInvitePopupSelect.bind(this)
			});

			this.invitePopup.show();
		},

		_onCallViewToggleMuteButtonClick: function(e)
		{
			this.currentCall.setMuted(e.muted);
			this.callView.setMuted(e.muted);
			if(this.floatingWindow)
			{
				this.floatingWindow.setAudioMuted(e.muted);
			}
		},

		_onCallViewToggleScreenSharingButtonClick: function(e)
		{
			if(this.currentCall.isScreenSharingStarted())
			{
				this.currentCall.stopScreenSharing();
			}
			else
			{
				this.callView.releaseLocalMedia();
				this.currentCall.startScreenSharing();
			}
		},

		_onCallViewToggleVideoButtonClick: function(e)
		{
			if(!e.video)
			{
				this.callView.releaseLocalMedia();
			}
			this.currentCall.setVideoEnabled(e.video);
		},

		_onCallViewShowHistoryButtonClick: function(e)
		{
			this.messenger.openHistory(this.currentCall.associatedEntity.id);
		},

		_onCallViewFullScreenButtonClick: function(e)
		{
			if(this.folded)
			{
				this.unfold();
			}
			this.callView.toggleFullScreen();
		},

		_onCallViewReplaceCamera: function(e)
		{
			if(this.currentCall)
			{
				this.currentCall.setCameraId(e.deviceId);
			}

			// update default camera
			BX.Call.Hardware.defaultCamera = e.deviceId;
		},

		_onCallViewReplaceMicrophone: function(e)
		{
			if(this.currentCall)
			{
				this.currentCall.setMicrophoneId(e.deviceId)
			}

			if(this.currentCall instanceof BX.Call.VoximplantCall)
			{
				this.callView.microphoneId = e.deviceId;
			}

			// update default microphone
			BX.Call.Hardware.defaultMicrophone = e.deviceId;
		},

		_onCallViewReplaceSpeaker: function(e)
		{
			BX.Call.Hardware.defaultSpeaker = e.deviceId;
		},

		_onCallViewSetCentralUser: function(e)
		{
			if(e.stream && this.floatingWindow)
			{
				this.floatingWindowUser = e.userId;
				//this.floatingWindow.setStream(e.stream);
			}
		},

		_onCallUserInvited: function(e)
		{
			if(this.callView)
			{
				BX.Call.Util.getUsers(this.currentCall.id, [e.userId]).then(function(userData) {
					this.callView.updateUserData(userData)
				}.bind(this));
				this.callView.addUser(e.userId);
			}
		},

		_onCallDestroy: function(e)
		{
			if(this.currentCall)
			{
				this.removeVideoStrategy();
				this.removeCallEvents();
				this.currentCall = null;
			}
			this.callWithMobile = false;

			if(this.callNotification)
			{
				this.callNotification.close();
			}
			if(this.invitePopup)
			{
				this.invitePopup.close();
			}
			if(this.callView && this.autoCloseCallView)
			{
				this.callView.close();
			}
			if(this.floatingWindow)
			{
				this.floatingWindow.close();
			}

			window.BXIM.messenger.dialogStatusRedraw();
			window.BXIM.stopRepeatSound('dialtone');
			window.BXIM.stopRepeatSound('ringtone');
		},

		_onCallUserStateChanged: function(e)
		{
			setTimeout(this.updateFloatingWindowContent.bind(this), 100);
			if(this.callView)
			{
				this.callView.setUserState(e.userId, e.state);
				if(e.isMobile)
				{
					this.callView.disableAddUser();
					this.callView.disableSwitchCamera();
					this.callView.disableScreenSharing();
					this.callView.disableMediaSelection();
					this.callView.updateButtons();
				}
			}

			if(e.state == BX.Call.UserState.Connecting || e.state == BX.Call.UserState.Connected)
			{
				window.BXIM.stopRepeatSound('dialtone');
			}
			if(e.state == BX.Call.UserState.Connected)
			{
				/*BX.Call.Util.getUser(e.userId).then(function(userData)
				{
					this.showNotification(BX.Call.Util.getCustomMessage("IM_M_CALL_USER_CONNECTED", {
						gender: userData.gender,
						name: userData.name
					}));
				}.bind(this));*/
			}
			else if(e.state == BX.Call.UserState.Idle && e.previousState == BX.Call.UserState.Connected)
			{
				/*BX.Call.Util.getUser(e.userId).then(function(userData)
				{
					this.showNotification(BX.Call.Util.getCustomMessage("IM_M_CALL_USER_DISCONNECTED", {
						gender: userData.gender,
						name: userData.name
					}));
				}.bind(this));*/
			}
			else if(e.state == BX.Call.UserState.Failed)
			{
				BX.Call.Util.getUser(this.currentCall.id, e.userId).then(function(userData)
				{
					this.showNotification(BX.Call.Util.getCustomMessage("IM_M_CALL_USER_FAILED", {
						gender: userData.gender,
						name: userData.name
					}));
				}.bind(this));
			}
			else if(e.state == BX.Call.UserState.Declined)
			{
				BX.Call.Util.getUser(this.currentCall.id, e.userId).then(function(userData)
				{
					this.showNotification(BX.Call.Util.getCustomMessage("IM_M_CALL_USER_DECLINED", {
						gender: userData.gender,
						name: userData.name
					}));
				}.bind(this));
			}
			else if(e.state == BX.Call.UserState.Busy)
			{
				BX.Call.Util.getUser(this.currentCall.id, e.userId).then(function(userData)
				{
					this.showNotification(BX.Call.Util.getCustomMessage("IM_M_CALL_USER_BUSY", {
						gender: userData.gender,
						name: userData.name
					}));
				}.bind(this));
			}
		},

		_onCallUserMicrophoneState: function(e)
		{
			if(!this.callView)
			{
				return;
			}
			this.callView.setUserMicrophoneState(e.userId, e.microphoneState);
		},

		_onCallLocalMediaReceived: function(e)
		{
			this.log("Received local media stream " + e.tag);
			if(this.callView)
			{
				this.callView.setLocalStream(e.stream, e.tag == "main");
				this.callView.setButtonActive("screen", e.tag == "screen");
				if(e.tag == "screen")
				{
					this.callView.disableSwitchCamera();
					this.callView.updateButtons();
				}
				else
				{
					if(!this.currentCall.callFromMobile)
					{
						this.callView.enableSwitchCamera();
						this.callView.updateButtons();
					}
				}
			}

			if(this.currentCall && this.currentCall.videoEnabled && e.stream.getVideoTracks().length === 0)
			{
				this.showNotification(BX.message("IM_CALL_CAMERA_ERROR_FALLBACK_TO_MIC"));
			}
		},

		_onCallLocalMediaStopped: function(e)
		{
			// do nothing
		},

		_onCallUserStreamReceived: function(e)
		{
			if(this.callView)
			{
				this.callView.setStream(e.userId, e.stream);
			}

			if(this.floatingWindow && this.floatingWindowUser == e.userId)
			{
				//this.floatingWindow.setStream(e.stream);
			}
		},

		_onCallUserStreamRemoved: function(e)
		{
			// this is never used, i believe
		},

		_onCallUserVoiceStarted: function(e)
		{
			this.talkingUsers[e.userId] = true;
			if(this.callView)
			{
				this.callView.setUserTalking(e.userId, true);
			}
			if(this.floatingWindow)
			{
				this.floatingWindow.setTalking(Object.keys(this.talkingUsers).map(function(id){
					return Number(id);
				}));
			}
		},

		_onCallUserVoiceStopped: function(e)
		{
			if(this.talkingUsers[e.userId])
			{
				delete this.talkingUsers[e.userId];
			}
			if(this.callView)
			{
				this.callView.setUserTalking(e.userId, false);
			}
			if(this.floatingWindow)
			{
				this.floatingWindow.setTalking(Object.keys(this.talkingUsers).map(function(id){
					return Number(id);
				}));
			}
		},

		_onCallUserScreenState: function(e)
		{
			if(this.callView)
			{
				this.callView.setUserScreenState(e.userId, e.screenState);
			}
		},

		_onCallFailure: function(e)
		{
			var errorCode = e.code || e.name || e.error;
			console.error("Call failure: ", e);

			var errorMessage;

			if(e.name == "AuthResult" || errorCode == "AUTHORIZE_ERROR")
			{
				errorMessage = BX.message("IM_CALL_ERROR_AUTHORIZATION");
			}
			else if(e.name == "Failed" && errorCode == 403)
			{
				errorMessage = BX.message("IM_CALL_ERROR_HARDWARE_ACCESS_DENIED");
			}
			else if(errorCode == "ERROR_UNEXPECTED_ANSWER")
			{
				errorMessage = BX.message("IM_CALL_ERROR_UNEXPECTED_ANSWER");
			}
			else if(errorCode == "BLANK_ANSWER_WITH_ERROR_CODE")
			{
				errorMessage = BX.message("IM_CALL_ERROR_BLANK_ANSWER");
			}
			else if(errorCode == "BLANK_ANSWER")
			{
				errorMessage = BX.message("IM_CALL_ERROR_BLANK_ANSWER");
			}
			else if(errorCode == "ACCESS_DENIED")
			{
				errorMessage = BX.message("IM_CALL_ERROR_ACCESS_DENIED");
			}
			else if(errorCode == "NO_WEBRTC")
			{
				errorMessage = this.isHttps ? BX.message("IM_CALL_NO_WEBRT") : BX.message("IM_CALL_ERROR_HTTPS_REQUIRED");
			}
			else if(errorCode == "UNKNOWN_ERROR")
			{
				errorMessage = BX.message("IM_CALL_ERROR_UNKNOWN");
			}
			else
			{
				//errorMessage = BX.message("IM_CALL_ERROR_HARDWARE_ACCESS_DENIED");
				errorMessage = BX.message("IM_CALL_ERROR_UNKNOWN_WITH_CODE")
					.replace("#ERROR_CODE#", errorCode);
			}
			if(this.callView)
			{
				this.callView.showFatalError({text: errorMessage});
			}
			else
			{
				this.showNotification(errorMessage);
			}

			this.autoCloseCallView = false;

			if(this.currentCall)
			{
				this.removeVideoStrategy();
				this.removeCallEvents();
				this.currentCall = null;
			}
		},

		_onCallJoin: function(e)
		{
			if(e.local)
			{
				// self answer, no nothing
				return;
			}
			// remote answer, stop ringing and hide incoming cal notification
			if(this.currentCall)
			{
				this.removeVideoStrategy();
				this.removeCallEvents();
				this.currentCall = null;
			}

			if(this.callView)
			{
				this.callView.close();
			}

			if(this.callNotification)
			{
				this.callNotification.close();
			}

			if(this.invitePopup)
			{
				this.invitePopup.close();
			}

			if(this.floatingWindow)
			{
				this.floatingWindow.close();
			}

			window.BXIM.stopRepeatSound('dialtone');
		},

		_onCallLeave: function(e)
		{
			if (!e.local && this.currentCall && this.currentCall.ready)
			{
				this.log(new Error("received remote leave with active call!"));
				return;
			}
			if(this.currentCall)
			{
				this.removeVideoStrategy();
				this.removeCallEvents();
				this.currentCall = null;
			}

			if(this.callView)
			{
				this.callView.close();
			}

			if(this.invitePopup)
			{
				this.invitePopup.close();
			}

			if(this.floatingWindow)
			{
				this.floatingWindow.close();
			}

			if(this.callNotification)
			{
				this.callNotification.close();
			}

			window.BXIM.messenger.dialogStatusRedraw();
			window.BXIM.stopRepeatSound('dialtone');
			window.BXIM.stopRepeatSound('ringtone');
		},

		_onInvitePopupDestroy: function(e)
		{
			this.invitePopup = null;
		},

		_onInvitePopupSelect: function(e)
		{
			this.invitePopup.close();

			if(!this.currentCall)
			{
				return;
			}

			var userId = e.user.id;

			if(BX.Call.Util.isCallServerAllowed() && this.currentCall instanceof BX.Call.PlainCall)
			{
				// trying to switch to the server version of the call
				this.removeVideoStrategy();
				this.removeCallEvents();
				BX.Call.Engine.getInstance().createChildCall(
					this.currentCall.id,
					BX.Call.Provider.Voximplant,
					[userId]
				).then(function(e)
				{
					this.childCall = e.call;

					this.childCall.addEventListener(BX.Call.Event.onStreamReceived, this._onChildCallFirstStreamHandler);
					this.childCall.addEventListener(BX.Call.Event.onLocalMediaReceived, this._onCallLocalMediaReceivedHandler);

					this.childCall.inviteUsers({
						users: this.childCall.users
					});

				}.bind(this));
				this.callView.addUser(userId, BX.Call.UserState.Calling);
			}
			else
			{
				var currentUsers = this.currentCall.getUsers();
				if(Object.keys(currentUsers).length < BX.Call.Util.getUserLimit() - 1 || currentUsers.hasOwnProperty(userId))
				{
					this.currentCall.inviteUsers({
						users: [userId]
					});
				}
			}
		},

		_onWindowFocus: function()
		{
			if(!this.detached)
			{
				clearTimeout(this.showFloatingWindowTimeout);
				if(this.floatingWindow)
				{
					this.floatingWindow.hide();
				}
			}
		},

		_onWindowBlur: function(e)
		{
			clearTimeout(this.showFloatingWindowTimeout);
			if(this.currentCall && this.floatingWindow && this.callView)
			{
				this.showFloatingWindowTimeout = setTimeout(function()
				{
					if(this.currentCall && this.floatingWindow && this.callView)
					{
						this.floatingWindow.setTitle(this.currentCall.associatedEntity.name);
						BX.Call.Util.getUserAvatars(this.currentCall.id, this.getActiveCallUsers()).then(function(result)
						{
							this.floatingWindow.setAvatars(result);
							this.floatingWindow.show();
						}.bind(this));
					}
				}.bind(this), 300);
			}
		},

		_onBeforeUnload: function(e)
		{
			if(this.floatingWindow)
			{
				this.floatingWindow.close();
			}
			if(this.callNotification)
			{
				this.callNotification.close();
			}
			if(this.hasActiveCall())
			{
				e.preventDefault();
				e.returnValue = '';
			}
		},

		_onImTabChange: function(currentTab)
		{
			if(currentTab === "notify" && this.currentCall && this.callView)
			{
				this.fold();
			}
		},

		_onUpdateChatCounter: function()
		{
			if(!this.currentCall || !this.currentCall.associatedEntity || !this.currentCall.associatedEntity.id || !this.callView)
			{
				return;
			}

			var newCount = BX.MessengerCommon.getDialogCounter(this.currentCall.associatedEntity.id);
			this.callView.setButtonCounter("chat", newCount);
		},

		_onDeviceChange: function(e)
		{
			if(!this.currentCall || !this.currentCall.ready)
			{
				return;
			}

			var added = e.data.added;
			var removed = e.data.removed;
			if(added.length > 0)
			{
				this.log("New devices: ", added);
				BX.UI.Notification.Center.notify({
					content: BX.message("IM_CALL_DEVICES_FOUND") + "<br><ul>" + added.map(function(deviceInfo){ return "<li>"+deviceInfo.label}) +"</ul>",
					position: "top-right",
					autoHideDelay: 10000,
					closeButton: true,
					//category: "call-device-change",
					actions: [
						{
							title: BX.message("IM_CALL_DEVICES_CLOSE"),
							events: {
								click: function(event, balloon, action) {
									balloon.close();
								}.bind(this)
							}
						},
					]
				});
				this.useDevicesInCurrentCall(added);
			}

			if(removed.length > 0)
			{
				this.log("Removed devices: ", removed);
				this.removeDevicesFromCurrentCall(removed);
				BX.UI.Notification.Center.notify({
					content: BX.message("IM_CALL_DEVICES_DETACHED") + "<br><ul>" + removed.map(function(deviceInfo){ return "<li>"+deviceInfo.label})  +"</ul>",
					position: "top-right",
					autoHideDelay: 10000,
					closeButton: true,
					//category: "call-device-change",
					actions: [{
						title: BX.message("IM_CALL_DEVICES_CLOSE"),
						events: {
							click: function(event, balloon, action) {
								balloon.close();
							}
						}
					}]
				});
			}
		},

		_onFloatingVideoMainAreaClick: function(e)
		{
			BX.desktop.windowCommand("show");
			BX.desktop.changeTab("im");

			if(!this.currentCall)
			{
				return;
			}

			if(this.currentCall.associatedEntity && this.currentCall.associatedEntity.id)
			{
				this.messenger.openMessenger(this.currentCall.associatedEntity.id);
			}
			else if(!this.isMessengerOpen())
			{
				this.messenger.openMessenger();
			}

			if(this.detached)
			{
				this.container.style.removeProperty('width');
				this.callView.show();
				this.detached = false;
			}
		},

		_onFloatingVideoButtonClick: function(e)
		{
			switch (e.buttonName)
			{
				case "toggleMute":
					this._onCallViewToggleMuteButtonClick(e);
					break;
				case "hangup":
					this._onCallViewHangupButtonClick();
					break;
			}
		},

		destroy: function()
		{
			if(this.floatingWindow)
			{
				this.floatingWindow.destroy();
				this.floatingWindow = null;
			}
		},

		log: function()
		{
			if(this.currentCall)
			{
				var arr = [this.currentCall.id];

				BX.CallEngine.log.apply(BX.CallEngine, arr.concat(Array.prototype.slice.call(arguments)));
			}
			else
			{
				BX.CallEngine.log.apply(BX.CallEngine, arguments);
			}
		},

		/*test: async function(users = [473, 464], videoOptions = {width: 1280, height: 720}, audioOptions = false)
		{
			await this.messenger.openMessenger();
			await BX.Call.Hardware.init();
			this.createContainer();
			this.callView = new BX.Call.View({
				container: this.container,
				showChatButtons: true,
				userLimit: 48,
				language: window.BXIM.language,
				layout: BX.Call.View.Layout.Centered,
			});

			let lastUserId = 1;

			this.callView.setCallback('onButtonClick',  (e) => {
				console.log(e.data);
				switch (e.buttonName)
				{
					case "hangup":
					case "close":
						this.callView.close();
						break;
					case "inviteUser":
						lastUserId++;
						this.callView.addUser(lastUserId, BX.Call.UserState.Connected);
						this.callView.setStream(lastUserId, stream2);

				}
			});
			this.callView.setUiState(BX.Call.View.UiState.Preparing);
			this.callView.setCallback('onClose', this._onCallViewClose.bind(this));
			this.callView.show();

			var stream = await navigator.mediaDevices.getUserMedia({
				audio: audioOptions,
				video: videoOptions,
			});

			this.callView.setLocalStream(stream);
			users.forEach(userId => {
				this.callView.addUser(userId, BX.Call.UserState.Connected);
			});



			var stream2 = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: {
					width: 640,
					height: 480
				},
			});

			users.forEach(userId => {
				this.callView.setStream(userId, stream);
			});
		}*/
	}
})();