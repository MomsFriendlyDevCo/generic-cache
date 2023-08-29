/**
* Base config used for testing
*/
export default {
	filesystem: {
		enabled: false,
	},
	memory: {
		enabled: true,
	},
	memcached: {
		enabled: false,
	},
	mongodb: {
		enabled: false,
		testSerializer: false,
	},
	redis: {
		enabled: false,
	},
	supabase: {
		enabled: false,
		testSerializer: false,
		uri: null, // FIXME: Fill this in if you want to test Supabase
		apikey:  null, // FIXME: Fill this in if you want to test Supabase
	},
}
