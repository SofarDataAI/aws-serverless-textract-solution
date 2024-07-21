import { SQSEvent } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { TextractClient, GetDocumentAnalysisCommand } from "@aws-sdk/client-textract";
import { SQSClient, DeleteMessageCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { TextractDocument } from 'amazon-textract-response-parser';

const s3Client = new S3Client({});
const textractClient = new TextractClient({});
const sqsClient = new SQSClient({});

const S3_JSON_FILES_BUCKET_NAME = process.env.S3_JSON_FILES_BUCKET_NAME;
const TEXT_ANALYSIS_RESULT_QUEUE_URL = process.env.TEXTRACT_RESULT_QUEUE_URL;
const TEXT_ANALYSIS_RESULT_DLQ_QUEUE_URL = process.env.TEXTRACT_RESULT_DLQ_QUEUE_URL;

/**
 * Lambda function handler to receive the result of a Textract job for table analysis.
 * It retrieves the analysis result, processes it to extract tables, and stores the result in S3.
 * If the job fails, it sends a message to a dead letter queue.
 *
 * @param {SQSEvent} event - The SQS event with details about the Textract job completion.
 * @returns {Promise<void>} A promise that resolves when the function has completed.
 */
export const handler = async (event: SQSEvent): Promise<void> => {
    const correlationId = uuidv4();
    const method = 'textract-receive-result.handler';
    const prefix = `${correlationId} - ${method}`;
    console.log(`${prefix} - started.`);

    for (const record of event.Records) {
        const body = JSON.parse(record.body);
        const jobId = body.JobId;
        const objectKey = body.ObjectKey;
        const bucketName = body.BucketName;

        // console log all variables above
        console.log(`JobId: ${jobId}`);
        console.log(`ObjectKey: ${objectKey}`);
        console.log(`BucketName: ${bucketName}`);

        // ask Textract for the analysis result
        const getDocumentAnalysisCommand = new GetDocumentAnalysisCommand({ JobId: jobId });
        const analysisResult = await textractClient.send(getDocumentAnalysisCommand);

        console.log(`${prefix} - analysisResult.JobStatus`, analysisResult.JobStatus);
        if (analysisResult.JobStatus === 'SUCCEEDED') {
            const response = JSON.parse(JSON.stringify(analysisResult));

            const tableBlocks = analysisResult.Blocks?.filter((block: any) => block.BlockType === 'TABLE');
            console.log(`${prefix} - table blocks: ${JSON.stringify(tableBlocks)}`);

            const document = new TextractDocument(response);

            console.log(`Number of pages in document: ${document.listPages().length}, document name: ${objectKey}`);
            for (const documentPage of document.listPages()) {
                console.log(`Number of tables in page ${documentPage.pageNumber}: ${documentPage.listTables().length}`);
                console.log(`documentTable text: ${JSON.stringify(documentPage.text)}`);

                for (const documentTable of documentPage.listTables()) {
                    // Extract table data and print it to console log
                    const tableData = extractTableData(documentTable);
                    console.log(`Table data for page ${documentPage.pageNumber}:`);
                    console.log(JSON.stringify(tableData));
                }

                const putObjectCommand = new PutObjectCommand({
                    Bucket: S3_JSON_FILES_BUCKET_NAME,
                    Key: `${objectKey}-documentPage.json`,
                    Body: `${JSON.stringify(documentPage.text)}`,
                    ContentType: 'application/json'
                });
                await s3Client.send(putObjectCommand);
            }

            // Delete the message from the queue after processing
            const deleteMessageCommand = new DeleteMessageCommand({
                QueueUrl: TEXT_ANALYSIS_RESULT_QUEUE_URL,
                ReceiptHandle: record.receiptHandle
            });
            try {
                await sqsClient.send(deleteMessageCommand);
            }
            catch (e) {
                console.log(`Fail to delete message in SQS: ${e}`)
            }
        } else if (analysisResult.JobStatus === "FAILED") {
            // Send a message to the dead letter queue with the job ID, object key, and bucket name
            const sendMessageCommand = new SendMessageCommand({
                QueueUrl: TEXT_ANALYSIS_RESULT_DLQ_QUEUE_URL,
                MessageBody: JSON.stringify({
                    JobId: jobId,
                    ObjectKey: objectKey,
                    BucketName: bucketName
                }),
            });
            await sqsClient.send(sendMessageCommand);
        }
        else {
            console.log(`Job status is ${analysisResult.JobStatus}.`);
            throw new Error(`Textract job ${jobId} is not complete.`);
        }
    }
};

/**
 * Extracts table data from a Textract document table.
 * @param documentTable - The Textract document table object.
 * @returns An array of objects representing the table data.
 */
function extractTableData(documentTable: any): any[] {
    const tableData: any[] = [];
    const rows = documentTable.rowCount;
    const cols = documentTable.columnCount;

    for (let i = 0; i < rows; i++) {
        const rowData: any = {};
        for (let j = 0; j < cols; j++) {
            const cell = documentTable.getCell(i, j);
            if (cell) {
                const cellContent = cell.text;
                rowData[`Column${j + 1}`] = cellContent;
            } else {
                rowData[`Column${j + 1}`] = '';
            }
        }
        tableData.push(rowData);
    }

    return tableData;
}
