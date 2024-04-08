import {defaultsDeep, isNil} from 'lodash-es';
import redis from 'redis';

export default function(settings, cache) {
	let driver = {};

	driver.settings = defaultsDeep(settings, {
		redis: {
			serialize: cache.settings.serialize,
			deserialize: cache.settings.deserialize,
			retry_strategy: ()=> undefined, // Stop after first try
		},
	});

	driver.canLoad = ()=> {
		cache.debug('canLoad', driver.settings.redis);
		driver.client = redis.createClient(driver.settings.redis);

		// TODO: Would like to make errors descriptive but a global handler does not seem to catch them
		//driver.client.on('error', e => {
		//	cache.debug('canLoad.error', e, typeof e);
		//});

		return driver.client.connect()
			.then(() => true)
			.catch(() => false);
	};

	driver.set = (key, val, expiry) => {
		if (!expiry) {
			return driver.client.set(key, driver.settings.serialize(val));
		} else {
			return driver.client.set(...[
				key,
				driver.settings.serialize(val),
				...(expiry && [
					'PXAT', // Prefix that next operand expiry date (in milliseconds)
					expiry.getTime() // Millisecond date to timeout
				]),
			]);
		}
	};

	driver.get = (key, fallback) => {
		return driver.client.get(key)
			.then(val => val ? driver.settings.deserialize(val) : fallback);
	};

	driver.size = key => {
		return driver.client.STRLEN(key);
	};

	driver.unset = key => {
		return driver.client.del(key);
	};

	driver.list = ()=> {
		var glob = driver.utilRegExpToGlob(driver.settings.keyQuery());
		if (glob == '.') glob = '*'; // Convert single char (anything) matches to glob all

		return driver.client.keys(glob)
			.then(keys => keys.map(doc => ({
				id: doc,
			})));
	};

	driver.has = key => {
		return driver.client.exists(key)
			.then(exists => !!exists)
	};

	driver.lockAquire = (key, val, expiry) => {
		const options = {
			'NX': true, // Only set if non-existant
			...(expiry && {
				//'PXAT': expiry.getTime(), // Millisecond date to timeout // TODO: Starting with Redis version 6.2.0: Added the GET, EXAT and PXAT option.
				'PX': expiry.getTime() - new Date().getTime(), // Milliseconds until timeout
			}),
		};
		return driver.client.set(key, (!isNil(val)) ? driver.settings.serialize(val) : 'LOCK', options)
			.then(result => result === 'OK');
	};

	driver.lockHydrate = (key, val, expiry) => {
		const options = {
			'XX': true, // Only set if existant
			...(expiry && {
				//'PXAT': expiry.getTime(), // Millisecond date to timeout // TODO: Starting with Redis version 6.2.0: Added the GET, EXAT and PXAT option.
				'PX': expiry.getTime() - new Date().getTime(), // Milliseconds until timeout
			}),
		};
		return driver.client.set(key, (!isNil(val)) ? driver.settings.serialize(val) : 'LOCK', options)
			.then(result => result === 'OK');
	};

	driver.lockRelease = key => driver.client.del(key)
		.then(res => res === 1);

	driver.lockExists = driver.has;

	driver.destroy = ()=> {
		return driver.client.quit();
	};

	/**
	* Utility function to convert a RegExp to a Redis glob query
	* @param {RegExp} re Regular expression to convert
	* @returns {string} A (basic) Redis glob
	*/
	driver.utilRegExpToGlob = re =>
		re
			.toString()
			.replace(/^\/(.*)\/$/, '$1') // Remove prefix / suffix braces
			.replace(/\?/g, '.')
			.replace(/\.\*/g, '*')
			.replace(/\.\+/g, '*');

	return driver;
}
