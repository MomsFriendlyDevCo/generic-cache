import BaseCache from './base.js';
import Debug from 'debug';

const debug = Debug('cache');

export default class Cache extends BaseCache {
	debug(...args) {
		debug(...args);
	}
}
