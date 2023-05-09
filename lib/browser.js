import BaseCache from './base.js';
import modLocalstorage from '../modules/localstorage.js';

export default class Cache extends BaseCache {
	modules = ['localstorage'];

	modulesCache = {
		localstorage: modLocalstorage,
	};

	debug(...args) {
		console.debug('cache', ...args);
	}
}
