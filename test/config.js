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
		enabled: true,
	},
	supabase: {
		enabled: true,
		testSerializer: false,
		uri: 'https://vffelkusqbafnxvrjbwt.supabase.co',
		apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmZmVsa3VzcWJhZm54dnJqYnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTExMjIzNDIsImV4cCI6MjAwNjY5ODM0Mn0.aOifMUcHkG1kjSe2vFLfRP_p7orw829UGKOy3H4FGrg',
	},
}
