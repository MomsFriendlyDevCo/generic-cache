import marshal from '@momsfriendlydevco/marshal';

/* global window */
let LS = window.localStorage;

export default function() {
	let driver = {};
	driver.store = {};

	driver.canLoad = ()=> !! LS;

	driver.set = (key, val, expiry) => {
		LS.setItem(key, marshal.serialize({
			value: val,
			expiry: expiry,
			created: new Date(),
		}));

		return val;
	};

	driver.get = (key, fallback) => {
		let existing = marshal.deserialize(LS.getItem(key));
		let now = new Date();
		if (existing && (!existing.expiry || existing.expiry > now)) { // Is valid and has not yet expired
			return existing.value;
		} else if (existing && existing.expiry && existing.expiry <= now) { // Has expired - release memory
			return Promise.resolve(driver.unset(key)).then(()=> fallback);
		} else { // Not found anyway
			return fallback;
		}
	};

	driver.size = key => {
		let existing = marshal.deserialize(LS.getItem(key));
		if (!existing) return undefined;
		return marshal.serialize(existing.value).length;
	};

	driver.unset = key => LS.remoteItem(key);

	driver.has = key => !! LS.getItem(key);

	driver.list = ()=> Object.entries(LS)
		.map((k, v) => ({
			id: k,
			expiry: v.expiry,
			created: v.created,
		}));

	driver.clean = ()=> LS.clear();

	driver.destroy = ()=> null;

	return driver;
}
