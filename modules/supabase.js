import _ from 'lodash';
import {createClient as Supabase} from '@supabase/supabase-js'

export default function(settings) {
	let driver = {};

	driver.settings = _.defaultsDeep(settings, {
		supabase: {
			uri: null,
			apikey: null,
			options: {},
			table: 'cache',
			colId: 'id',
			colCreated: 'created_at',
			colExpires: 'expires_at',
			colData: 'data',
		},
	});

	driver.canLoad = ()=> {
		if (!driver.settings.supabase.uri || !driver.settings.supabase.apikey) return false;

		driver.supabase = Supabase(
			driver.settings.supabase.uri,
			driver.settings.supabase.apikey,
			_.merge(
				{},
				driver.settings.supabase.options,
				{
					auth: {
						persistSession: false,
					},
				},
			),
		);

		return true;
	};


	driver.get = (key, fallback) => driver.supabase
		.from(driver.settings.supabase.table)
		.select(`${driver.settings.supabase.colId}, ${driver.settings.supabase.colExpires}, ${driver.settings.supabase.colData}`)
		.single()
		.eq(driver.settings.supabase.colId, key)
		.then(({data: doc}) => {
			if (!doc) { // Not found
				return fallback;
			} else if (doc?.[driver.settings.supabase.colExpires] && new Date(doc[driver.settings.supabase.colExpires]) < new Date()) { // Expired
				return driver.unset(key).then(()=> fallback);
			} else { // Value ok
				return doc[driver.settings.supabase.colData];
			}
		})


	driver.set = (key, value, expiry) => driver.supabase
		.from(driver.settings.supabase.table)
		.upsert({
			[driver.settings.supabase.colId]: key,
			[driver.settings.supabase.colData]: value,
			[driver.settings.supabase.colExpires]: expiry,
		})
		.eq(driver.settings.supabase.colId, key)
		.select(driver.settings.supabase.colData)


	driver.unset = key => driver.supabase
		.from(driver.settings.supabase.table)
		.delete()
		.eq(driver.settings.supabase.colId, key)


	driver.list = ()=> driver.supabase
		.from(driver.settings.supabase.table)
		.select(`${driver.settings.supabase.colId}, ${driver.settings.supabase.colCreated}`)
		.then(({data: rows}) => rows.map(r => ({
			id: r[driver.settings.supabase.colId],
			created: r[driver.settings.supabase.colCreated],
			expires: r[driver.settings.supabase.colExpires],
		})))


	driver.clean = ()=> driver.supabase
		.from(driver.settings.supabase.table)
		.delete()

	return driver;
}
