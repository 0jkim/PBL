// server/webpack.server.config.js

const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = {
  entry: './server/app02.js',
  target: 'node',
  externals: [nodeExternals()],
  output: {
    filename: 'server.bundle.js',
    path: path.resolve(__dirname, '../dist'),
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
};