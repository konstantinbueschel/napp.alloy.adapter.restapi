/**
 * Rest API Adapter for Titanium Alloy
 * @author Mads Møller
 * @version 1.1.15
 * Copyright Napp ApS
 * www.napp.dk
 */

var LTAG = '[REST API]',
	DEBUG = false,
	PROPERTY_IDENTIFIER = 'NAPP_REST_ADAPTER',
	
	// we need underscore
	// until this issue is fixed: https://jira.appcelerator.org/browse/TIMOB-11752
	Alloy = require("alloy"),
	Backbone = Alloy.Backbone,
	_ = require("alloy/underscore")._;


function S4() {
	
	return ((1 + Math.random()) * 65536 | 0).toString(16).substring(1);
	
} // END S4()


function guid() {
	
	return S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4();
	
} // END guid()


function InitAdapter(config) {
	
	return {};
	
} // END InitAdapter()

function apiCall(_options, _callback) {
	
	if (Ti.Network.online) {
		
		var xhr = Ti.Network.createHTTPClient({
			
			timeout: _options.timeout || 7000
		});
		
		xhr.onload = function() {
			
			var responseJSON, success = this.status <= 304 ? "ok" : "error",
				status = true, error;
			
			// save the eTag for future reference
			_options.eTagEnabled && success && setETag(_options.url, xhr.getResponseHeader('ETag'));
			
			// we dont want to parse the JSON on a empty response
			if (this.status != 304 && this.status != 204) {
				
				// parse JSON
				try {
					responseJSON = JSON.parse(this.responseText);
				}
				catch (parseException) {
					
					DEBUG && Ti.API.error(LTAG, 'apiCall parse error:', parseException.message);
					DEBUG && Ti.API.error(LTAG, 'apiCall parse error:', this.responseText);
					
					status = false;
					error = parseException.message;
				}
			}
			
			_callback({
				
				success: status,
				status: success,
				code: this.status,
				data: error,
				responseText: this.responseText || null,
				responseJSON: responseJSON || null
			});
			
			cleanup();
		};
		
		//Handle error
		xhr.onerror = function(event) {
			
			var responseJSON, error;
			
			try {
				
				responseJSON = JSON.parse(this.responseText);
			}
			catch (parseException) {
				
				error = parseException.message;
			}
			
			_callback({
				
				success: false,
				status: "error",
				code: this.status,
				error: event.error,
				data: error,
				responseText: this.responseText,
				responseJSON: responseJSON || null
			});
			
			DEBUG && Ti.API.error(LTAG, 'apiCall error:', this.responseText);
			DEBUG && Ti.API.error(LTAG, 'apiCall error code:', this.status);
			DEBUG && Ti.API.error(LTAG, 'apiCall error msg:', event.error);
			DEBUG && Ti.API.error(LTAG, 'apiCall error url:', _options.url);
			
			cleanup();
		};
		
		_options.beforeOpen && _options.beforeOpen(xhr);
		
		//Prepare the request
		xhr.open(_options.type, _options.url);
		
		// headers
		for (var header in _options.headers) {
			
			// use value or function to return value
			xhr.setRequestHeader(header, _.isFunction(_options.headers[header]) ? _options.headers[header]() : _options.headers[header]);
		}
		
		_options.beforeSend && _options.beforeSend(xhr);
		
		if (_options.eTagEnabled) {
			
			var etag = getETag(_options.url);
			
			etag && xhr.setRequestHeader('IF-NONE-MATCH', etag);
		}
		
		if (_options.type != 'GET' && !_.isEmpty(_options.data)) {
			
			xhr.send(_options.data);
		}
		else {
			
			xhr.send();
		}
	}
	else {
		
		// we are offline
		_callback({
			
			success: false,
			status: "offline",
			offline: true,
			responseText: null
		});
	}
	
	/**
	 * Clean up the request
	 */
	function cleanup() {
		
		xhr = null;
		_options = null;
		_callback = null;
		error = null;
		responseJSON = null;
	}
	
} // END apiCall()


function Sync(method, model, opts) {
	
	model.idAttribute = model.config.adapter.idAttribute || "id";
	
	DEBUG = model.config.debug;
	
	var eTagEnabled = model.config.eTagEnabled,
		
		// Used for custom parsing of the response data
		parentNode = model.config.parentNode,
		
		// CRUD <-> REST mapping
		methodMap = {
			'create': 'POST',
			'read': 'GET',
			'update': 'PUT',
			'delete': 'DELETE'
		},
		
		type = methodMap[method],
		
		params = _.extend({}, opts);
	
	
	_.defaults(params, {
		
		//set default headers
		headers: {},
		url: model.config.URL || model.url(),
		type: opts.requestMethod || type,
		pathParams: {},
		urlParams: {}
	});
	
	
	// Send our own custom headers
	if (model.config.hasOwnProperty("headers")) {
		
		var configHeaders = model.config.headers,
			header;
		
		_.isFunction(configHeaders) && (configHeaders = configHeaders());
		
		for (header in configHeaders) {
			
			params.headers[header] = configHeaders[header];
		}
	}
	
	
	// We need to ensure that we have a base url.
	if (!params.url) {
		
		DEBUG && Ti.API.error(LTAG, "error: no base url");
		
		return;
	}
	
	
	// Extend the provided url params with those from the model config
	model.config.urlParams && _.extend(params.urlParams, _.result(model.config, 'urlParams'));
	
	
	// extend the provided path params with those from the model config and parse them into url
	model.config.pathParams && _.extend(params.pathParams, _.result(model.config, 'pathParams'));
	
	_.each(params.pathParams, function(value, key) {
		
		params.url = params.url.replace("{" + key + "}", (value ? escape(value) : ""), "gi");
	});
	
	
	// For older servers, emulate JSON by encoding the request into an HTML-form.
	if (Alloy.Backbone.emulateJSON) {
		
		params.contentType = 'application/x-www-form-urlencoded';
		params.processData = true;
		params.data = params.data ? {
			
			model: params.data
			
		} : {};
	}
	
	// For older servers, emulate HTTP by mimicking the HTTP method with `_method`
	// And an `X-HTTP-Method-Override` header.
	if (Alloy.Backbone.emulateHTTP) {
		
		if (type === 'PUT' || type === 'DELETE') {
			
			Alloy.Backbone.emulateJSON && (params.data._method = type);
			
			params.type = 'POST';
			
			params.beforeSend = function(xhr) {
				
				params.headers['X-HTTP-Method-Override'] = type;
			};
		}
	}
	
	//json data transfers
	!params.data && model && (method == 'create' || method == 'update') && (params.headers['Content-Type'] = 'application/json');
	
	logger(DEBUG, "REST METHOD", method);
	
	switch (method) {
		
		case 'create' :
			
			// convert to string for API call
			params.data = JSON.stringify(model.toJSON());
			
			logger(DEBUG, "create options", params);
			
			apiCall(params, function(_response) {
				
				if (_response.success) {
					
					var data = parseJSON(DEBUG, _response, parentNode, model);
					
					//Rest API should return a new model id.
					//if not - create one
					data[model.idAttribute] === undefined && (data[model.idAttribute] = guid());
					
					params.success(data, _response.responseJSON);
					
					// fire event
					opts.silent || model.trigger("fetch");
				}
				else {
					
					Alloy.Backbone.VERSION === '0.9.2' ? params.error(_response, _response.responseText) : params.error(_response);
					
					DEBUG && Ti.API.error(LTAG, 'CREATE ERROR:', _response);
				}
			});
			
			break;
		
		case 'read':
			
			model.id && (params.url = params.url + '/' + model.id);
			
			// search mode
			params.search && (params.url = params.url + "/search/" + Ti.Network.encodeURIComponent(params.search));
			
			// build url with parameters
			params.urlParams && (params.url = encodeData(params.urlParams, params.url));
			
			// If we have set optional parameters on the request we should use it
			// when params.urlparams fails/is empty.
			!params.urlParams && params.type !== "POST" && params.data && (params.url = encodeData(params.data, params.url));
			
			eTagEnabled && (params.eTagEnabled = true);
			
			logger(DEBUG, "read options", params);
			
			apiCall(params, function(_response) {
				
				if (_response.success) {
					
					var data = parseJSON(DEBUG, _response, parentNode, model),
						values = [],
						length = 0;
					
					data = [].concat(data);
					
					for (var i in data) {
						
						var item = {};
						
						item = data[i];
						
						item && item[model.idAttribute] === undefined && (item[model.idAttribute] = guid());
						
						values.push(item);
						
						length++;
					}
					
					params.success((length === 1) ? values[0] : values, _response.responseJSON);
					
					opts.silent || model.trigger("fetch");
				}
				else {
					
					Alloy.Backbone.VERSION === '0.9.2' ? params.error(model, _response) : params.error(_response);
					
					DEBUG && Ti.API.error(LTAG, 'READ ERROR:', _response);
				}
			});
			break;
		
		case 'update' :
			
			if (!model.id) {
				
				params.error(null, "MISSING MODEL ID");
				
				DEBUG && Ti.API.error(LTAG, "ERROR: MISSING MODEL ID");
				
				return;
			}
			
			// setup the url & data
			if (_.indexOf(params.url, "?") == -1) {
				
				params.url = params.url + '/' + model.id;
			}
			else {
				
				var str = params.url.split("?");
				
				params.url = str[0] + '/' + model.id + "?" + str[1];
			}
			
			params.urlParams && (params.url = encodeData(params.urlParams, params.url));
			
			params.data = JSON.stringify(model.toJSON());
			
			logger(DEBUG, "update options", params);
			
			apiCall(params, function(_response) {
				
				if (_response.success) {
					
					var data = parseJSON(DEBUG, _response, parentNode, model);
					
					params.success(data, _.response.responseJSON);
					
					opts.silent || model.trigger("fetch");
				}
				else {
					
					Alloy.Backbone.VERSION === '0.9.2' ? params.error(model, _response) : params.error(_response);
					
					DEBUG && Ti.API.error(LTAG, 'UPDATE ERROR:', _response);
				}
			});
			
			break;
		
		case 'delete' :
			
			if (!model.id) {
				
				params.error(null, "MISSING MODEL ID");
				
				DEBUG && Ti.API.error(LTAG, "ERROR: MISSING MODEL ID");
				
				return;
			}
			
			if (_.indexOf(params.url, "?") == -1) {
				
				params.url = params.url + '/' + model.id;
			}
			else {
				
				var str = params.url.split("?");
				
				params.url = str[0] + '/' + model.id + "?" + str[1];
			}
			
			params.urlParams && (params.url = encodeData(params.urlParams, params.url));
			
			logger(DEBUG, "delete options", params);
			
			apiCall(params, function(_response) {
				
				if (_response.success) {
					
					var data = parseJSON(DEBUG, _response, parentNode, model);
					
					params.success(null, _response.responseJSON);
					
					opts.silent || model.trigger("fetch");
				}
				else {
					
					Alloy.Backbone.VERSION === '0.9.2' ? params.error(model, _response) : params.error(_response);
					
					DEBUG && Ti.API.error(LTAG, 'DELETE ERROR:', _response);
				}
			});
			break;
	}
	
} // END Sync()


/////////////////////////////////////////////
// HELPERS
/////////////////////////////////////////////

function logger(DEBUG, message, data) {
	
	DEBUG && Ti.API.debug(LTAG, message, (data ? (typeof data === 'object' ? JSON.stringify(data, null, '\t') : data) : ''));
	
} // END logger()


function parseJSON(DEBUG, _response, parentNode, model) {
	
	var data = _response.responseJSON;
	
	_.isUndefined(parentNode) || (data = _.isFunction(parentNode) ? parentNode(data, _response, model) : traverseProperties(data, parentNode));
	
	logger(DEBUG, "server response", _response);
	
	return data;
	
} // END parseJSON()


function traverseProperties(object, string) {
	
	var explodedString = string.split('.'),
		i = 0, l = explodedString.length;
	
	for (; i < l; i++) {
		
		object = object[explodedString[i]];
	}
	
	return object;
	
} // END traverseProperties()


function _serialize(obj, prefix) {
	
	var str = [],
		property, key, value;
	
	// loop through object properties
	for (property in obj) {
		
		// check if has property
		if (obj.hasOwnProperty(property)) {
			
			// fetch value and add prefix to key
			key = prefix ? prefix + "[" + property + "]" : property;
			
			value = obj[property];
			
			// call self recursive or add key/value pair
			str.push(typeof value === "object" ? _serialize(value, key) : Ti.Network.encodeURIComponent(key) + "=" + Ti.Network.encodeURIComponent(value));
		}
	}
	
	return str.join("&");
	
} // END _serialize()


function encodeData(obj, url) {
	
	var hasUrlParams = !!~_.indexOf(url, "?"),
		urlJSON, exisitingParamsToKeep;
	
	if (hasUrlParams) {
		
		urlJSON = require("alloy/string").urlToJson(url);
		
		logger(DEBUG, "Url as JSON:", urlJSON);
		
		exisitingParamsToKeep = _.omit(urlJSON.query, Object.keys(obj));
		
		url = urlJSON.url.concat("?", _serialize(exisitingParamsToKeep));
		
		logger(DEBUG, "Url after params cleanup, before encoding:", url);
	}
	
	url = url + (hasUrlParams ? "&" : "?") + _serialize(obj);
	
	logger(DEBUG, "Encoded url:", url);
	
	return url;
	
} // END encodeData()


/**
 * Get the ETag for the given url
 * @param {Object} url
 */
function getETag(url) {
	
	var obj = Ti.App.Properties.getObject(PROPERTY_IDENTIFIER, {}),
		data = obj[url];
	
	return data || null;
	
} // END getETag()

/**
 * Set the ETag for the given url
 * @param {Object} url
 * @param {Object} eTag
 */
function setETag(url, eTag) {
	
	if (eTag && url) {
		
		var obj = Ti.App.Properties.getObject(PROPERTY_IDENTIFIER, {});
		
		obj[url] = eTag;
		
		Ti.App.Properties.setObject(PROPERTY_IDENTIFIER, obj);
	}
}


// PUBLIC INTERFACE
module.exports.sync = Sync;

module.exports.beforeModelCreate = function(config, name) {
	
	config = config || {};
	
	InitAdapter(config);
	
	return config;
};

module.exports.afterModelCreate = function(Model, name) {
	
	Model = Model || {};
	
	Model.prototype.config.Model = Model;
	Model.prototype.idAttribute = Model.prototype.config.adapter.idAttribute;
	
	return Model;
};
