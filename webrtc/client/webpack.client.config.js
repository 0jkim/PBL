// client/webpack.client.config.js

const path = require('path');

module.exports = {
  entry: './client/src/index02.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, '../public/dist'),
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      },
    ],
  },
  mode: 'development',
  devServer: {
    static: {
      directory: path.join(__dirname, '../public'),
    },
    compress: true,
    port: 443, // 원하는 포트로 변경 가능
    open: true,
  },
};