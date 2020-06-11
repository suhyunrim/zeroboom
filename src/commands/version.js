exports.run = async (message, args) => {
	var detailVerionInfo = "%VERSION%";
	return pdetailVerionInfo;
}

exports.conf = {
	enabled: true,
	aliases: ['v', '버전'],
};

exports.help = {
	name: 'version',
	description: 'version info',
	usage: 'version'
};
