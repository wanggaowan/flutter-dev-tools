import type { TemplateChildEntity, TemplateEntity } from "./file-template-utils";

/**
 * 内置默认模板，与 IntelliJ 插件的默认模板保持一致
 */
export function createDefaultTemplates(): TemplateEntity[] {
  return [
    createPageTemplate(),
    createSimplePageTemplate(),
    createFormPageTemplate(),
    createSimpleFormPageTemplate(),
    createViewPagerPageTemplate(),
    createSimpleViewPagerPageTemplate(),
  ];
}

function createPageTemplate(): TemplateEntity {
  return createTemplate("page", [
    createFile("view.dart", pageViewContent),
    createFile("controller.dart", pageControllerContent),
    createFile("state.dart", pageStateContent),
  ]);
}

function createSimplePageTemplate(): TemplateEntity {
  return createTemplate("simplePage", [
    createFile("view.dart", simplePageViewContent),
    createFile("controller.dart", simplePageControllerContent),
  ]);
}

function createFormPageTemplate(): TemplateEntity {
  return createTemplate("formPage", [
    createFile("view.dart", formPageViewContent),
    createFile("controller.dart", formPageControllerContent),
    createFile("state.dart", formPageStateContent),
  ]);
}

function createSimpleFormPageTemplate(): TemplateEntity {
  return createTemplate("simpleFormPage", [
    createFile("view.dart", simpleFormPageViewContent),
    createFile("controller.dart", simpleFormPageControllerContent),
  ]);
}

function createViewPagerPageTemplate(): TemplateEntity {
  return createTemplate("viewPagerPage", [
    createFile("view.dart", viewPagerPageViewContent),
    createFile("controller.dart", viewPagerPageControllerContent),
    createFile("state.dart", viewPagerPageStateContent),
  ]);
}

function createSimpleViewPagerPageTemplate(): TemplateEntity {
  return createTemplate("simpleViewPagerPage", [
    createFile("view.dart", simpleViewPagerPageViewContent),
    createFile("controller.dart", simpleViewPagerPageControllerContent),
  ]);
}

function createTemplate(
  name: string,
  children: TemplateChildEntity[],
): TemplateEntity {
  return { name, createFolder: false, children };
}

function createFile(name: string, content: string): TemplateChildEntity {
  return { name, content, isFolder: false };
}

/**
 * 去除多行文本的公共缩进，等价于 Kotlin 的 trimIndent
 */
function dedent(text: string): string {
  const lines = text.replace(/^\n+/, "").replace(/\s+$/, "").split("\n");
  let indent = -1;
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    const length = line.length - line.trimStart().length;
    if (indent === -1 || length < indent) {
      indent = length;
    }
  }

  if (indent <= 0) {
    return lines.join("\n");
  }

  return lines
    .map(line => (line.trim().length === 0 ? "" : line.substring(indent)))
    .join("\n");
}

const pageViewContent = dedent(`
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:kq_flutter_core_widget/getx/kq_get_builder.dart';
import 'package:kq_flutter_widgets/widgets/emptyView/empty_view.dart';
import 'package:kq_flutter_widgets/widgets/titleBar/kq_title_bar.dart';

import 'controller.dart';

/// #desc#
/// create by #USER# #DATETIME#
class #pageName#Page extends StatefulWidget {
  const TestPage({super.key});

  @override
  State<#pageName#Page> createState() => _#pageName#PageState();
}

class _#pageName#PageState extends State<#pageName#Page> {
  final _controller = #pageName#Controller();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: KqHeadBar(
        // todo 填写界面标题
        headTitle: '',
        back: Get.back,
      ),
      body: KqGetBuilder(
        init: _controller,
        global: false,
        builder: (controller) => _buildBody(context),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_controller.state.firstRequest) {
      return const SizedBox();
    }

    if (_controller.state.isDataEmpty) {
      return const KqEmptyView(forceSliver: false, autoSliver: false);
    }

    // todo 完善具体的界面逻辑
    return const Placeholder();
  }
}
`);

const pageControllerContent = dedent(`
import 'package:kq_flutter_core_widget/getx/kq_get_builder.dart';

import 'state.dart';

class #pageName#Controller extends KqGetXController {
  final #pageName#State state = #pageName#State();
}
`);

const pageStateContent = dedent(`
class #pageName#State {
  #pageName#State() {
    ///Initialize variables
  }

  bool firstRequest = true;

  bool get isDataEmpty => true;
}
`);

const simplePageViewContent = dedent(`
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:kq_flutter_core_widget/getx/kq_get_builder.dart';
import 'package:kq_flutter_widgets/widgets/emptyView/empty_view.dart';
import 'package:kq_flutter_widgets/widgets/titleBar/kq_title_bar.dart';

import 'controller.dart';

/// #desc#
/// create by #USER# #DATETIME#
class #pageName#Page extends StatefulWidget {
  const #pageName#Page({super.key});

  @override
  State<#pageName#Page> createState() => _#pageName#PageState();
}

class _#pageName#PageState extends State<#pageName#Page> {
  final _controller = #pageName#Controller();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: KqHeadBar(
        // todo 填写界面标题
        headTitle: '',
        back: Get.back,
      ),
      body: KqGetBuilder(
        init: _controller,
        global: false,
        builder: (controller) => _buildBody(context),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_controller.state.isFirstRequest) {
      return const SizedBox();
    }

    if (_controller.state.isDataEmpty) {
      return const KqEmptyView(forceSliver: false, autoSliver: false);
    }

    // todo 完善具体的界面逻辑
    return const Placeholder();
  }
}
`);

const simplePageControllerContent = dedent(`
import 'package:kq_flutter_core_widget/getx/kq_get_builder.dart';

class #pageName#Controller extends KqGetXController {
  final #pageName#State state = #pageName#State();
}

class #pageName#State {
  #pageName#State() {
    ///Initialize variables
  }

  bool _firstRequest = true;

  bool get isDataEmpty => true;

  bool get isFirstRequest => _firstRequest;
}
`);

const formPageViewContent = dedent(`
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:kq_flutter_core_widget/extentions/kq_extentions.dart';
import 'package:kq_flutter_core_widget/getx/kq_get_builder.dart';
import 'package:kq_flutter_core_widget/utils/kq_screen_util.dart';
import 'package:kq_flutter_widgets/utils/kq_form_util.dart';
import 'package:kq_flutter_widgets/widgets/button/kq_bottom_button.dart';
import 'package:kq_flutter_widgets/widgets/titleBar/kq_title_bar.dart';

import 'controller.dart';

/// #desc#
/// create by #USER# #DATETIME#
class #pageName#Page extends StatefulWidget {
  const TestPage({super.key});

  @override
  State<#pageName#Page> createState() => _#pageName#PageState();
}

class _#pageName#PageState extends State<#pageName#Page> {
  final _controller = #pageName#Controller();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: KqHeadBar(
        // todo 填写界面标题
        headTitle: '',
        back: Get.back,
      ),
      body: KqGetBuilder(
        init: _controller,
        global: false,
        builder: (controller) => _buildBody(context),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    return Column(
              children: [
                Expanded(
                    child: SingleChildScrollView(
                  keyboardDismissBehavior: Platform.isIOS
                      ? ScrollViewKeyboardDismissBehavior.onDrag
                      : ScrollViewKeyboardDismissBehavior.manual,
                  child: Column(
                    children: [
                      ...KqFormUtil.renderFormWidgetList(_controller.state.formData),
                      // 防止键盘下来时抖动
                      SizedBox(height: 50.r,)
                    ],
                  ),
                )),
                if (!context.keyboardVisible)
                  KqBottomButton(
                    // todo 填写提交按钮名称
                    title: '',
                    onTap: (disabled) {
                      _controller.submitData();
                    },
                  )
              ],
            );
  }
}
`);

const formPageControllerContent = dedent(`
import 'package:get/get.dart';
import 'package:kq_flutter_core_widget/getx/kq_get_builder.dart';
import 'package:kq_flutter_core_widget/network/response.dart';
import 'package:kq_flutter_widgets/utils/kq_form_util.dart';

import 'state.dart';

class #pageName#Controller extends KqGetXController {
  final #pageName#State state = #pageName#State();

  @override
  void onInit() {
    super.onInit();
    state.formData = [
      //todo 填充表单实体数据

    ];
    update();
  }

  /// 提交数据
  submitData() async {
    // 检查必填项
    if (KqFormUtil.checkMustInputForm(state.formData)) {
      return;
    }
    // 表单数据
    var params = KqFormUtil.getFormSubmitJson(state.formData);
    // 请求接口
    #apiName#Api.#methodName#(
      params,
      cancelToken: createCancelToken(),
      callback: (response) {
        if (response.code == ApiResponse.success) {
          // 关闭页面
          Get.back(result: true);
        }
      },
    );
  }
}
`);

const formPageStateContent = dedent(`
import 'package:kq_flutter_widgets/widgets/formItem/entity/kq_form_entity.dart';

class #pageName#State {
  #pageName#State() {
    ///Initialize variables
  }

  /// 表单实体
  List<KqFormEntity> formData = [];
}
`);

const simpleFormPageViewContent = dedent(`
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:kq_flutter_core_widget/extentions/kq_extentions.dart';
import 'package:kq_flutter_core_widget/getx/kq_get_builder.dart';
import 'package:kq_flutter_core_widget/utils/kq_screen_util.dart';
import 'package:kq_flutter_widgets/utils/kq_form_util.dart';
import 'package:kq_flutter_widgets/widgets/button/kq_bottom_button.dart';
import 'package:kq_flutter_widgets/widgets/titleBar/kq_title_bar.dart';

import 'controller.dart';

/// #desc#
/// create by #USER# #DATETIME#
class #pageName#Page extends StatefulWidget {
  const TestPage({super.key});

  @override
  State<#pageName#Page> createState() => _#pageName#PageState();
}

class _#pageName#PageState extends State<#pageName#Page> {
  final _controller = #pageName#Controller();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: KqHeadBar(
        // todo 填写界面标题
        headTitle: '',
        back: Get.back,
      ),
      body: KqGetBuilder(
        init: _controller,
        global: false,
        builder: (controller) => _buildBody(context),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    return Column(
              children: [
                Expanded(
                    child: SingleChildScrollView(
                  keyboardDismissBehavior: Platform.isIOS
                      ? ScrollViewKeyboardDismissBehavior.onDrag
                      : ScrollViewKeyboardDismissBehavior.manual,
                  child: Column(
                    children: [
                      ...KqFormUtil.renderFormWidgetList(_controller.state.formData),
                      // 防止键盘下来时抖动
                      SizedBox(height: 50.r,)
                    ],
                  ),
                )),
                if (!context.keyboardVisible)
                  KqBottomButton(
                    // todo 填写提交按钮名称
                    title: '',
                    onTap: (disabled) {
                      _controller.submitData();
                    },
                  )
              ],
            );
  }
}
`);

const simpleFormPageControllerContent = dedent(`
import 'package:get/get.dart';
import 'package:kq_flutter_core_widget/getx/kq_get_builder.dart';
import 'package:kq_flutter_core_widget/network/response.dart';
import 'package:kq_flutter_widgets/utils/kq_form_util.dart';
import 'package:kq_flutter_widgets/widgets/formItem/entity/kq_form_entity.dart';

class #pageName#Controller extends KqGetXController {
  final #pageName#State state = #pageName#State();

  @override
  void onInit() {
    super.onInit();
    state.formData = [
      //todo 填充表单实体数据

    ];
    update();
  }

  /// 提交数据
  submitData() async {
    // 检查必填项
    if (KqFormUtil.checkMustInputForm(state.formData)) {
      return;
    }
    // 表单数据
    var params = KqFormUtil.getFormSubmitJson(state.formData);
    // 请求接口
    #apiName#Api.#methodName#(
      params,
      cancelToken: createCancelToken(),
      callback: (response) {
        if (response.code == ApiResponse.success) {
          // 关闭页面
          Get.back(result: true);
        }
      },
    );
  }
}

class #pageName#State {
  #pageName#State() {
    ///Initialize variables
  }

  /// 表单实体
  List<KqFormEntity> formData = [];
}
`);

const viewPagerPageViewContent = dedent(`
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:kq_flutter_core_widget/getx/kq_get_builder.dart';
import 'package:kq_flutter_widgets/widgets/emptyView/empty_view.dart';
import 'package:kq_flutter_widgets/widgets/tabbar/kq_tab_bar.dart';
import 'package:kq_flutter_widgets/widgets/tabbar/kq_tab_bar_page_view.dart';
import 'package:kq_flutter_widgets/widgets/titleBar/kq_title_bar.dart';

import 'controller.dart';

/// #desc#
/// create by #USER# #DATETIME#
class #pageName#Page extends StatefulWidget {
  const #pageName#Page({super.key});

  @override
  State<#pageName#Page> createState() => _#pageName#PageState();
}

class _#pageName#PageState extends State<#pageName#Page> {
  final _controller = #pageName#Controller();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: KqHeadBar(
        // todo 填写界面标题
        headTitle: '',
        back: Get.back,
      ),
      body: KqGetBuilder(
        init: _controller,
        global: false,
        builder: (controller) => _buildBody(context),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_controller.state.firstRequest) {
      return const SizedBox();
    }

    if (_controller.state.isDataEmpty) {
      return const KqEmptyView(forceSliver: false, autoSliver: false);
    }

    return Column(
      children: [
        KqTabBar(
          tabController: _controller.tabController,
          items: [
            // todo 初始化标签页
          ],
        ),
        Expanded(
          child: KqTabBarView(
            controller: _controller.tabController,
            children: [
              // todo 初始化标签页对应的界面
            ],
          ),
        )
      ],
    );
  }
}
`);

const viewPagerPageControllerContent = dedent(`
import 'package:flutter/material.dart';
import 'package:kq_flutter_core_widget/getx/kq_get_builder.dart';

import 'state.dart';

class #pageName#Controller extends KqGetXController {
  final #pageName#State state = #pageName#State();
  TabController? _tabController;

  TabController get tabController =>
      _tabController ??= TabController(length: state.pageCount, vsync: vsync);
}
`);

const viewPagerPageStateContent = dedent(`
class #pageName#State {
  #pageName#State() {
    ///Initialize variables
  }

  bool firstRequest = true;

  bool get isDataEmpty => true;

  int get pageCount => 0;
}
`);

const simpleViewPagerPageViewContent = viewPagerPageViewContent;

const simpleViewPagerPageControllerContent = dedent(`
import 'package:flutter/material.dart';
import 'package:kq_flutter_core_widget/getx/kq_get_builder.dart';

class #pageName#Controller extends KqGetXController {
  final #pageName#State state = #pageName#State();
  TabController? _tabController;

  TabController get tabController =>
      _tabController ??= TabController(length: state.pageCount, vsync: vsync);
}

class #pageName#State {
  #pageName#State() {
    ///Initialize variables
  }

  bool firstRequest = true;

  bool get isDataEmpty => true;

  int get pageCount => 0;
}
`);
