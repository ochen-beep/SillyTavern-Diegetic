# Harness панели

Автономная проверка панели без таверны. Скопируй перед запуском:

    cp dist/diegetic.js tests/harness/
    cp "~~local-path~~\public\lib\jquery-3.5.1.min.js" tests/harness/

Затем подними статический сервер в этой папке (например `npx http-server -p 8391`)
и открой http://127.0.0.1:8391/index.html. Кнопка ◆ открывает панель;
стабы дают один пост, три артефакта в списке и два CM-профиля.
