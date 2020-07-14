const calcLength = (str) => 
{
	var pattern_kor = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
	var strLength = 0;
	
	for (var i = 0; i < str.length; i++) 
	{
		if(pattern_kor.test(str.charAt(i)))
		{
			strLength += 2;
		}
		else
		{
			strLength += 1;
		}
	}

	return strLength;
}

const reducer = (maxLen, str) => 
{
	var strLength = calcLength(str);
	maxLen = Math.max(strLength, maxLen);
	return maxLen;
}

class Table 
{
	constructor(columns) 
	{
		this.columns = columns;
		this.rows = new Array();
		this.maxLen = columns.reduce(reducer, 0);
	}

	AddRow(values) 
	{
		this.maxLen = values.reduce(reducer, this.maxLen);
		this.rows.push(values);
	}

	Print() 
	{
		var ret = "```\n";
		var rowFullLength = this.maxLen * this.columns.length + this.columns.length * 3 - 1;

		for(var i = 0; i < this.columns.length; i++)
		{
			ret += this.columns[i];
			for(var j = 0; j < this.maxLen - calcLength(this.columns[i]); j++)
			{
				ret += ' ';
			}
			ret += '   ';
		}
		ret += '\n';

		for(var i = 0 ; i < rowFullLength; i++) 
		{
			ret += '=';
		}
		ret += '\n';

		for(var i = 0; i < this.rows.length; i++)
		{
		
			for(var j = 0; j < this.columns.length; j++)
			{
				ret += this.rows[i][j];
				for(var k = 0; k < this.maxLen - calcLength(this.rows[i][j]); k++)
				{
					ret += ' ';
				}
				ret += '   ';
			}
			ret += '\n';
		}

		ret += "\n```";
		return ret;
	}
}

exports.Table = Table;
