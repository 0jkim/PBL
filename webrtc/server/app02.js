// Required modules
const fs = require('fs');
const https = require('https');
const express = require('express');
const socketIo = require('socket.io');
const mediasoup = require('mediasoup');
const path = require('path');

const app = express();

// HTTPS 서버 설정을 위해 인증서 경로
const options = {
    key: fs.readFileSync('/etc/letsencrypt/live/webrtc.n-e.kr/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/webrtc.n-e.kr/fullchain.pem')
};

const httpsServer = https.createServer(options, app);
const io = socketIo(httpsServer);

// Express로 기본 경로 설정
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index02.html'));
});

// HTTP 서버 실행 (포트 443)
httpsServer.listen(443, () => {
    console.log('서버가 실행중');
});

let worker;
let router;
let transports = {}; // 클라이언트별 Transport 정보 저장
let producers = {}; // 클라이언트별 Producer 저장
let consumers = {}; // 클라이언트별 Consumer 저장

// Mediasoup Worker 생성 함수
async function createMediasoupWorker() {
    // Worker 생성
    try {
        worker = await mediasoup.createWorker({
            rtcMinPort: 10000,
            rtcMaxPort: 10100,  // WebRTC에서 사용할 최소 및 최대 포트 지정
        });

        console.log('워커 생성 완료');
    } catch (error) {
        console.log("워커 생성 실패", error);
    }
    worker.on('died', () => {
        console.error('워커 삭제. 서버를 종료합니다.');
        process.exit(1);  // Worker가 죽으면 서버를 종료.
    });

    // Router 생성
    await createRouter();
}

// Mediasoup Router 생성 함수
async function createRouter() {
    // 미디어 코덱 설정
    const mediaCodecs = [
        {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
        },
        {
            kind: 'video',
            mimeType: 'video/VP8',
            clockRate: 90000,
        },
    ];
    try {
        router = await worker.createRouter({ mediaCodecs });
        console.log('라우터 생성 성공');
    } catch (error) {
        console.log("라우터 생성 실패", error);
    }
}

createMediasoupWorker();

// 서버의 Socket.IO 이벤트 처리
io.on('connection', (socket) => {
    console.log(socket.id, ' : 새로운 클라이언트 접속');

    // 라우터의 RTP 정보를 클라이언트에게 전달
    socket.on('getRouterRtpCapabilities', async (callback) => {
        console.log(socket.id, " : 라우터 RTP정보 요청이 들어옴");
        try {
            await callback(router.rtpCapabilities);
        } catch (error) {
            console.log(socket.id, ' : RTP 데이터 보내기 실패', error);
        }
    });

    transports[socket.id] = { producerTransport: null, consumerTransports: [] };
    producers[socket.id] = [];
    consumers[socket.id] = [];

    // 기존의 모든 Producer 정보를 새 클라이언트에게 전달
    socket.on('produceDone', () => {
        for (let clientId in producers) {
            producers[clientId].forEach(producer => {
                socket.emit('newProducer', { producerId: producer.id, clientId, kind: producer.kind });
            });
        }
    });

    // Producer Transport 생성 요청 처리
    socket.on('createProducerTransport', async (_, callback) => {
        console.log(socket.id, ' : Producer Transport 생성 요청');

        try {
            const producerTransport = await router.createWebRtcTransport({
                listenIps: [{ ip: '0.0.0.0', announcedIp: '117.16.153.134' }],
                enableUdp: true,
                enableTcp: true,
            });

            transports[socket.id].producerTransport = producerTransport;

            console.log(socket.id, ' : Producer Transport 생성 완료');

            callback({
                id: producerTransport.id,
                iceParameters: producerTransport.iceParameters,
                iceCandidates: producerTransport.iceCandidates,
                dtlsParameters: producerTransport.dtlsParameters,
            });
        } catch (error) {
            console.error(socket.id, ' : Producer Transport 생성 실패', error);
            callback({ error: error.message });
        }
    });

    // Consumer Transport 생성 요청 처리
    socket.on('createConsumerTransport', async (_, callback) => {
        console.log(socket.id, ' : Consumer Transport 생성 요청');

        try {
            const consumerTransport = await router.createWebRtcTransport({
                listenIps: [{ ip: '0.0.0.0', announcedIp: '117.16.153.134' }],
                enableUdp: true,
                enableTcp: true,
            });

            transports[socket.id].consumerTransports.push(consumerTransport);

            console.log(socket.id, ' : Consumer Transport 생성 완료');

            callback({
                id: consumerTransport.id,
                iceParameters: consumerTransport.iceParameters,
                iceCandidates: consumerTransport.iceCandidates,
                dtlsParameters: consumerTransport.dtlsParameters,
            });
        } catch (error) {
            console.error(socket.id, ' : Consumer Transport 생성 실패', error);
            callback({ error: error.message });
        }
    });

    // 클라이언트가 ProducerTransport를 만들고 연결을 요청
    socket.on('connectProducerTransport', async ({ dtlsParameters }, callback) => {
        console.log(socket.id, ' : Producer Transport 연결 요청');
        try {
            const producerTransport = transports[socket.id].producerTransport;
            if (!producerTransport) {
                throw new Error('ProducerTransport가 존재하지 않습니다');
            }

            await producerTransport.connect({ dtlsParameters });
            callback();
        } catch (error) {
            console.error('connectProducerTransport 오류:', error);
            callback({ error: error.message });
        }
    });

    // 클라이언트가 ConsumerTransport 연결을 요청
    socket.on('connectConsumerTransport', async ({ dtlsParameters }, callback) => {
        console.log(socket.id, ' : Consumer Transport 연결 요청');
        try {
            const consumerTransport = transports[socket.id].consumerTransports[0];
            if (!consumerTransport) {
                throw new Error('ConsumerTransport가 존재하지 않습니다');
            }

            await consumerTransport.connect({ dtlsParameters });
            callback();
        } catch (error) {
            console.error('connectConsumerTransport 오류:', error);
            callback({ error: error.message });
        }
    });

    // 사용자가 미디어 스트림을 생성 (produce)
    socket.on('produce', async ({ kind, rtpParameters }, callback) => {
        console.log(socket.id, ' : 미디어 스트림 생성 요청, kind:', kind);

        try {
            const producerTransport = transports[socket.id].producerTransport;
            if (!producerTransport) {
                throw new Error('ProducerTransport가 존재하지 않습니다');
            }

            const producer = await producerTransport.produce({ kind, rtpParameters });
            producers[socket.id].push(producer);

            console.log('Producer created for client:', socket.id, 'Producer ID:', producer.id);

            callback({ id: producer.id });

            // 다른 클라이언트에게 새로운 Producer가 생겼음을 알림
            socket.broadcast.emit('newProducer', { producerId: producer.id, clientId: socket.id, kind });
        } catch (error) {
            console.error('produce 오류:', error);
            callback({ error: error.message });
        }
    });

    // 사용자가 미디어를 소비 (consume)
    // 사용자가 미디어를 소비 (consume)
socket.on('consume', async ({ producerId, kind, rtpCapabilities }, callback) => {
    console.log(socket.id, ' : 미디어 소비 요청');

    try {
        if (!router.canConsume({ producerId, rtpCapabilities })) {
            throw new Error('미디어 소비가 불가능합니다');
        }

        let consumerTransport = transports[socket.id].consumerTransports[0];

        // ConsumerTransport가 없으면 오류 반환 대신 생성 재시도 또는 대기
        if (!consumerTransport) {
            console.warn(socket.id, ' : ConsumerTransport가 존재하지 않습니다, 다시 생성합니다.');

            // ConsumerTransport를 생성하여 재시도
            consumerTransport = await router.createWebRtcTransport({
                listenIps: [{ ip: '0.0.0.0', announcedIp: '117.16.153.134' }],
                enableUdp: true,
                enableTcp: true,
            });

            transports[socket.id].consumerTransports.push(consumerTransport);

            // ConsumerTransport 연결 요청 (여기서 클라이언트로부터 필요한 dtlsParameters를 받아야 함)
            socket.emit('getDtlsParametersForConsumer', {}, async ({ dtlsParameters }) => {
                try {
                    await consumerTransport.connect({ dtlsParameters });
                    consumerTransport._isConnected = true;
                    console.log(socket.id, ' : Consumer Transport 연결 성공');

                    // 이제 실제로 Consumer 생성
                    const consumer = await consumerTransport.consume({
                        producerId,
                        rtpCapabilities,
                    });

                    console.log('Consumer created for client:', socket.id, 'Consumer ID:', consumer.id);

                    consumers[socket.id].push(consumer);

                    // Consumer 정보를 클라이언트에 전달
                    callback({
                        id: consumer.id,
                        producerId,
                        kind: consumer.kind,
                        rtpParameters: consumer.rtpParameters,
                    });
                } catch (error) {
                    console.error('ConsumerTransport 연결 오류:', error);
                    callback({ error: error.message });
                }
            });

            return; // 이후 consumer 생성 로직은 dtlsParameters 받아서 처리 후 진행됨
        }

        // 기존의 연결된 ConsumerTransport가 있는 경우 직접 소비 시작
        const consumer = await consumerTransport.consume({
            producerId,
            rtpCapabilities,
        });

        console.log('Consumer created for client:', socket.id, 'Consumer ID:', consumer.id);

        consumers[socket.id].push(consumer);

        // Consumer 정보를 클라이언트에 전달
        callback({
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
        });
    } catch (error) {
        console.error('consume 오류:', error);
        callback({ error: error.message });
    }
});
    // 클라이언트 연결 해제 처리
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        // 연결 해제 시 모든 관련 리소스 해제
        if (transports[socket.id]) {
            if (transports[socket.id].producerTransport) {
                transports[socket.id].producerTransport.close();
            }
            transports[socket.id].consumerTransports.forEach(transport => transport.close());
        }

        producers[socket.id].forEach(producer => producer.close());
        consumers[socket.id].forEach(consumer => consumer.close());

        delete transports[socket.id];
        delete producers[socket.id];
        delete consumers[socket.id];

        // 모든 클라이언트에게 연결 해제된 클라이언트의 비디오를 제거하라고 알림
        io.emit('removeClient', { clientId: socket.id });
    });
});